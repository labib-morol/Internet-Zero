import type { RuntimeState, WorldBundle } from "@iz/schema";

/** Parses an ISO-8601 timestamp; returns undefined when unparseable. */
export function parseIsoMs(iso: string): number | undefined {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * World time (§13): session clock mode means worldTime = epoch + (now -
 * startedAt); global clock mode means world time IS the injected now (the
 * scheduler outside the runtime owns firing in that mode). Returns undefined
 * when any input timestamp is unparseable; callers must treat that as
 * "comparison not decidable" and evaluate time-based checks to false.
 */
export function worldTimeMs(bundle: WorldBundle, state: RuntimeState, now: string): number | undefined {
  const nowMs = parseIsoMs(now);
  if (nowMs === undefined) return undefined;
  if (bundle.world.clock.mode === "global") return nowMs;
  const epochMs = parseIsoMs(bundle.world.clock.epoch);
  const startedMs = parseIsoMs(state.startedAt);
  if (epochMs === undefined || startedMs === undefined) return undefined;
  return epochMs + (nowMs - startedMs);
}
