import type { Action, Actor, Clock, GameEvent, Rejection, RuntimeState, WorldBundle } from "@iz/schema";
import { apply, fold, initialState, type ApplyResult } from "@iz/runtime";
import { runTerminalCommand } from "./terminal-run.js";
import type { Db } from "./db/client.js";
import { append, readAll } from "./db/events.js";
import type { EventEnvelope } from "./db/events.js";

/**
 * Team state service (§9, §12): loads state by folding the team's event log,
 * applies actions through the runtime, appends with an optimistic version
 * check and retries ONCE on (team_id, seq) conflict with a fresh fold.
 * Snapshots (§15) are an M1 optimization: this path reads the events table only.
 */

export interface SubmitOutcome {
  result?: unknown;
  rejection?: Rejection;
  events: EventEnvelope[];
}

/** Serializes work per team so reads/writes cannot interleave within a team. */
export class TeamLocks {
  readonly #locks = new Map<string, Promise<void>>();

  async run<T>(teamId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(teamId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => gate);
    this.#locks.set(teamId, chained);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.#locks.get(teamId) === chained) {
        // Last waiter: keep the map tidy.
        this.#locks.delete(teamId);
      }
    }
  }
}

/**
 * Loads a team's current state by folding its full event log. The log MUST
 * start with SessionStarted (session creation writes it).
 */
export async function loadTeamState(
  db: Db,
  bundle: WorldBundle,
  teamId: string
): Promise<{ state: ReturnType<typeof fold>; envelopes: EventEnvelope[] }> {
  const envelopes = await readAll(db, teamId);
  if (envelopes.length === 0) {
    throw new Error(`Team ${teamId} has no event log (missing SessionStarted)`);
  }
  const state = fold(
    bundle,
    envelopes.map((envelope) => envelope.event)
  );
  return { state, envelopes };
}

export interface SubmitActionOptions {
  db: Db;
  bundle: WorldBundle;
  teamId: string;
  action: Action;
  actor: Actor;
  clock: Clock;
  locks: TeamLocks;
  /** Called with the appended envelopes after a successful write (WS broadcast). */
  onBroadcast?: (teamId: string, envelopes: EventEnvelope[]) => void;
}

/**
 * The single write path for actions (REST and WebSocket). Runs under the team
 * lock; on a sequence conflict it re-folds the stream, re-applies the action
 * and retries exactly once (§12) before giving up with a `conflict` rejection.
 */
export async function submitAction(opts: SubmitActionOptions): Promise<SubmitOutcome> {
  const { db, bundle, teamId, action, actor, clock, locks } = opts;
  return locks.run(teamId, async () => {
    const attempt = async (): Promise<{ lastSeq: number; applied: ApplyResult; state: RuntimeState }> => {
      const envelopes = await readAll(db, teamId);
      const lastSeq = envelopes.length === 0 ? 0 : envelopes[envelopes.length - 1]!.seq;
      const state =
        envelopes.length === 0
          ? initialState(bundle, teamId, clock.now())
          : fold(
              bundle,
              envelopes.map((envelope) => envelope.event)
            );
      // eventSeq = events already in the log; seeds deterministic ids (§9).
      const applied = apply(bundle, state, action, actor, clock, lastSeq);
      return { lastSeq, applied, state };
    };

    let { lastSeq, applied, state } = await attempt();

    // Terminal commands are interpreted server-side (M1 task 7): the runtime
    // gates the action; packages/terminal runs it against the world fs and
    // returns the events to append.
    let terminalResult: ReturnType<typeof runTerminalCommand> | undefined;
    if (action.type === "terminal" && applied.rejection === undefined) {
      terminalResult = runTerminalCommand(bundle, state, action.host, action.cwd, action.line, actor.userId, clock.now());
      if (!terminalResult.ok) {
        return { rejection: { code: terminalResult.code, message: terminalResult.message }, events: [] };
      }
    }
    const gameEvents: GameEvent[] =
      terminalResult !== undefined && terminalResult.ok ? [...applied.events, ...terminalResult.events] : applied.events;
    if (gameEvents.length > 0) {
      let outcome = await append(db, teamId, lastSeq + 1, gameEvents);
      if (!outcome.ok) {
        // Optimistic version check failed: fresh fold, re-apply, retry once.
        const retried = await attempt();
        lastSeq = retried.lastSeq;
        applied = retried.applied;
        state = retried.state;
        if (action.type === "terminal" && applied.rejection === undefined) {
          terminalResult = runTerminalCommand(bundle, state, action.host, action.cwd, action.line, actor.userId, clock.now());
          if (!terminalResult.ok) {
            return { rejection: { code: terminalResult.code, message: terminalResult.message }, events: [] };
          }
        }
        const retriedEvents: GameEvent[] =
          terminalResult !== undefined && terminalResult.ok ? [...applied.events, ...terminalResult.events] : applied.events;
        outcome = await append(db, teamId, lastSeq + 1, retriedEvents);
        if (!outcome.ok) {
          return {
            rejection: {
              code: "conflict",
              message: "The case file changed while processing this action. Try again.",
            },
            events: [],
          };
        }
      }
    }

    const envelopes: EventEnvelope[] = gameEvents.map((event: GameEvent, i: number) => ({
      seq: lastSeq + 1 + i,
      event,
    }));
    if (envelopes.length > 0) opts.onBroadcast?.(teamId, envelopes);
    const terminalPayload =
      terminalResult !== undefined && terminalResult.ok
        ? {
            output: terminalResult.output,
            cwd: terminalResult.cwd,
            ...(terminalResult.connect !== undefined ? { connect: terminalResult.connect } : {}),
          }
        : undefined;
    return {
      ...(terminalPayload !== undefined
        ? { result: terminalPayload }
        : applied.result !== undefined
          ? { result: applied.result }
          : {}),
      ...(applied.rejection !== undefined ? { rejection: applied.rejection } : {}),
      events: envelopes,
    };
  });
}
