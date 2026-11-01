import type { Actor, GameEvent, RuntimeState, WorldBundle } from "@iz/schema";

/**
 * Empty team state for a bundle (§9). `unlocked` starts EMPTY: hosts with no
 * `requires` are reachable by condition evaluation and artifact visibility is
 * computed dynamically (see visibility.ts), so there is nothing to seed.
 */
export function initialState(bundle: WorldBundle, teamId: string, startedAt: string): RuntimeState {
  return {
    teamId,
    worldId: bundle.world.id,
    bundleHash: bundle.bundleHash,
    startedAt,
    solvedGates: {},
    unlocked: new Set<string>(),
    evidence: {},
    claims: {},
    links: {},
    hintsUsed: {},
    reportGroupsAccepted: {},
    firedEvents: new Set<string>(),
    overlayFs: {},
    readPaths: {},
    attempts: {},
    score: 0,
  };
}

/**
 * The SessionStarted event every team stream must begin with; fold derives the
 * state's identity fields (teamId / worldId / bundleHash / startedAt) from it.
 * Servers compose this once per team and then only append events.
 */
export function sessionStartEvent(bundle: WorldBundle, teamId: string, startedAt: string, actor: Actor): GameEvent {
  return {
    type: "SessionStarted",
    teamId,
    worldId: bundle.world.id,
    bundleHash: bundle.bundleHash,
    startedAt,
    at: startedAt,
    by: actor.userId,
    actorKind: actor.kind,
  };
}
