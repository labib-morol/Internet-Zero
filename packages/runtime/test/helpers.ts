import type { Actor, Clock, GameEvent } from "@iz/schema";
import { apply, fold, initialState, sessionStartEvent } from "../src/index.js";
import type { ApplyResult } from "../src/index.js";
import { fixtureBundle, START, TEAM_ID } from "./fixtures/bundle.js";

/** Fixed clock (§9: "tests use a fixed clock"); advance/set between applies. */
export class TestClock implements Clock {
  private current: string;

  constructor(iso: string) {
    this.current = iso;
  }

  now(): string {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(Date.parse(this.current) + ms).toISOString();
  }

  set(iso: string): void {
    this.current = iso;
  }
}

export const ACTOR: Actor = { userId: "u.tester", kind: "human" };
export { fixtureBundle, START, TEAM_ID };

export function freshState() {
  return initialState(fixtureBundle, TEAM_ID, START);
}

export function startLog(): GameEvent[] {
  return [sessionStartEvent(fixtureBundle, TEAM_ID, START, ACTOR)];
}

export function applyAt(state: ReturnType<typeof freshState>, action: Parameters<typeof apply>[2], clock: Clock, logLength = 1): ApplyResult {
  return apply(fixtureBundle, state, action, ACTOR, clock, logLength);
}

/**
 * Canonical server loop: apply -> append events -> fold. Returns the final
 * folded state, the whole log and every per-action result.
 */
export function runSession(actions: Parameters<typeof apply>[2][], clock: Clock) {
  let state = freshState();
  const log = startLog();
  const results: ApplyResult[] = [];
  for (const action of actions) {
    const result = apply(fixtureBundle, state, action, ACTOR, clock, log.length);
    log.push(...result.events);
    state = fold(fixtureBundle, log);
    results.push(result);
  }
  return { state, log, results };
}
