import type { RuntimeState } from "@iz/schema";

/**
 * JSON wire form of RuntimeState (§9). The in-memory state carries Sets
 (`unlocked`, `firedEvents`, per-host `readPaths`) which JSON cannot express;
 on the wire they are sorted arrays. The reverse mapping on the client side is
 `new Set(...)`. Everything else passes through unchanged.
 */
export type WireRuntimeState = Omit<RuntimeState, "unlocked" | "firedEvents" | "readPaths"> & {
  unlocked: string[];
  firedEvents: string[];
  readPaths: Record<string, string[]>;
};

export function stateToWire(state: RuntimeState): WireRuntimeState {
  return {
    ...state,
    unlocked: [...state.unlocked].sort(),
    firedEvents: [...state.firedEvents].sort(),
    readPaths: Object.fromEntries(
      Object.entries(state.readPaths).map(([host, paths]) => [host, [...paths].sort()])
    ),
  };
}
