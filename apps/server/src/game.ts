import type { Action, Actor, Clock, GameEvent, Rejection, RuntimeState, WorldBundle } from "@iz/schema";
import { apply, fold, initialState, replayEvents, settleEvents, type ApplyResult } from "@iz/runtime";
import { runTerminalCommand } from "./terminal-run.js";
import type { Db } from "./db/client.js";
import { append, readAfter, nextSeq } from "./db/events.js";
import { readSnapshot, writeSnapshot } from "./db/snapshots.js";
import type { EventEnvelope } from "./db/events.js";

/**
 * Team state service (§9, §12): loads state by folding the team's event log,
 * applies actions through the runtime, appends with an optimistic version
 * check and retries ONCE on (team_id, seq) conflict with a fresh fold.
 * Validated snapshots (§15) cache raw replay prefixes at every 200 events.
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

/** Loads a validated snapshot plus its stream tail. Envelopes contain only replayed events. */
export async function loadTeamState(
  db: Db,
  bundle: WorldBundle,
  teamId: string
): Promise<{ state: RuntimeState; envelopes: EventEnvelope[]; lastSeq: number }> {
  const streamSeq = (await nextSeq(db, teamId)) - 1;
  const cached = await readSnapshot(db, bundle, teamId, streamSeq);
  const envelopes = await readAfter(db, teamId, cached?.seq ?? 0);
  let state: RuntimeState;
  if (cached !== undefined) {
    state = cached.state;
  } else {
    const first = envelopes[0]?.event;
    if (first === undefined) throw new Error(`Team ${teamId} has no event log (missing SessionStarted)`);
    // The runtime validates stream/bundle identity; never rebase an incompatible log.
    fold(bundle, [first]);
    if (first.type !== "SessionStarted" || first.teamId !== teamId) throw new Error("Invalid team stream identity");
    state = initialState(bundle, teamId, first.startedAt);
  }
  // Checkpoint raw replay state: implicit gates must finalize only at the actual tail,
  // not at an artificial 200-event chunk boundary.
  for (const envelope of envelopes) {
    replayEvents(bundle, state, [envelope.event]);
    if (envelope.seq % 200 === 0) await writeSnapshot(db, teamId, envelope.seq, state);
  }
  const last = envelopes[envelopes.length - 1];
  const lastSeq = last?.seq ?? cached?.seq ?? 0;
  return { state, envelopes, lastSeq };
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
  if (action.type === 'claim' && action.private) {
    return { events: [], rejection: { code: 'invalid_input', message: 'Use private notes for confidential observations.' } };
  }
  if (action.type === 'editClaim') {
    const { state } = await loadTeamState(db, bundle, teamId);
    if (state.claims[action.claimId]?.private) return { events: [], rejection: { code: 'invalid_input', message: 'Private claims are not shared.' } };
  }
  return locks.run(teamId, async () => {
    const attempt = async (): Promise<{ lastSeq: number; applied: ApplyResult; state: RuntimeState }> => {
      const { state, lastSeq } = await loadTeamState(db, bundle, teamId);
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
      terminalResult = runTerminalCommand(bundle, replayEvents(bundle, structuredClone(state), applied.events), action.host, action.cwd, action.line, actor.userId, clock.now());
      if (!terminalResult.ok) {
        applied = { ...applied, rejection: { code: terminalResult.code, message: terminalResult.message } };
        terminalResult = undefined;
      }
    }
    let gameEvents: GameEvent[] = settleEvents(bundle, state,
      terminalResult !== undefined && terminalResult.ok ? [...applied.events, ...terminalResult.events.map((event) => ({ ...event, actorKind: actor.kind }))] : applied.events,
      actor, clock);
    if (gameEvents.length > 0) {
      let outcome = await append(db, teamId, lastSeq + 1, gameEvents);
      if (!outcome.ok) {
        // Optimistic version check failed: fresh fold, re-apply, retry once.
        const retried = await attempt();
        lastSeq = retried.lastSeq;
        applied = retried.applied;
        state = retried.state;
        // Never carry the first attempt's terminal result into the retry: the
        // retried apply may reject outright, and a stale result would ride
        // back to the client alongside the rejection.
        terminalResult = undefined;
        if (action.type === "terminal" && applied.rejection === undefined) {
          terminalResult = runTerminalCommand(bundle, replayEvents(bundle, structuredClone(state), applied.events), action.host, action.cwd, action.line, actor.userId, clock.now());
          if (!terminalResult.ok) {
            applied = { ...applied, rejection: { code: terminalResult.code, message: terminalResult.message } };
        terminalResult = undefined;
          }
        }
        gameEvents = settleEvents(bundle, state,
          terminalResult !== undefined && terminalResult.ok ? [...applied.events, ...terminalResult.events.map((event) => ({ ...event, actorKind: actor.kind }))] : applied.events,
          actor, clock);
        outcome = await append(db, teamId, lastSeq + 1, gameEvents);
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
      if (Math.floor(lastSeq / 200) < Math.floor((lastSeq + gameEvents.length) / 200)) {
        await loadTeamState(db, bundle, teamId);
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
