import type { Attempt, EvidenceItem, RuntimeState } from "@iz/schema";

/**
 * JSON wire form of RuntimeState. The server serializes `unlocked`,
 * `firedEvents` and per-host `readPaths` as sorted ARRAYS (apps/server
 * state-wire.ts) because JSON has no sets. The client keeps the wire shape as
 * its canonical presentation state and re-sorts arrays when events are merged
 * (see events.ts), so what the client holds is always a valid wire state.
 *
 * Consumers that need real Sets can call `hydrateState`.
 */
export type WireRuntimeState = Omit<RuntimeState, "unlocked" | "firedEvents" | "readPaths"> & {
  unlocked: string[];
  firedEvents: string[];
  readPaths: Record<string, string[]>;
};

export interface HydratedRuntimeState {
  teamId: string;
  worldId: string;
  bundleHash: string;
  startedAt: string;
  solvedGates: Record<string, { at: string; by: string }>;
  unlocked: Set<string>;
  evidence: Record<string, EvidenceItem>;
  claims: Record<string, { id: string; text: string; slots?: Record<string, string>; createdBy: string; createdAt: string; private: boolean }>;
  links: Record<
    string,
    { id: string; from: string; to: string; relation: string; confidence: 1 | 2 | 3; createdBy: string; createdAt: string }
  >;
  hintsUsed: Record<string, number>;
  reportGroupsAccepted: Record<string, string[]>;
  firedEvents: Set<string>;
  overlayFs: Record<string, string>;
  readPaths: Record<string, Set<string>>;
  attempts: Record<string, Attempt[]>;
  score: number;
}

/** Arrays → Sets (the documented reverse mapping for the server's wire form). */
export function hydrateState(wire: WireRuntimeState): HydratedRuntimeState {
  return {
    ...wire,
    unlocked: new Set(wire.unlocked),
    firedEvents: new Set(wire.firedEvents),
    readPaths: Object.fromEntries(
      Object.entries(wire.readPaths).map(([host, paths]) => [host, new Set(paths)])
    ),
  };
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** Keep wire arrays sorted + unique (mirrors server serialization). */
export function normalizeWire(state: WireRuntimeState): WireRuntimeState {
  return {
    ...state,
    unlocked: sortedUnique(state.unlocked),
    firedEvents: sortedUnique(state.firedEvents),
    readPaths: Object.fromEntries(
      Object.entries(state.readPaths).map(([host, paths]) => [host, sortedUnique(paths)])
    ),
  };
}
