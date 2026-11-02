import { createHash } from "node:crypto";
import type { Fragment, RuntimeState } from "@iz/schema";

/**
 * Deterministic ids (§9): "Ids come from a deterministic generator seeded by
 * (teamId, event sequence)". Prefixes: evidence "ev", claim "cl", link "ln".
 *
 * The id is prefix + "." + first 16 hex chars of
 * sha256(`${teamId}:${eventSeq}:${kind}:${contentSalt}`).
 *
 * `eventSeq` should be the number of events already in the team's log when the
 * event is created. `apply` takes it as an optional trailing parameter; the
 * server passes the store's next sequence number. When omitted, apply derives a
 * sequence from the size of the id-bearing records (evidence + claims + links),
 * which is still deterministic for a given state but can reuse an id after an
 * unlink — callers that need strict uniqueness SHOULD pass eventSeq.
 */
export type IdPrefix = "ev" | "cl" | "ln";

export function deterministicId(
  prefix: IdPrefix,
  teamId: string,
  eventSeq: number,
  kind: string,
  contentSalt: string
): string {
  const hash = createHash("sha256").update(`${teamId}:${eventSeq}:${kind}:${contentSalt}`).digest("hex");
  return `${prefix}.${hash.slice(0, 16)}`;
}

/** Fallback sequence when the caller does not pass one (see module doc). */
const eventSequences = new WeakMap<RuntimeState, number>();

export function advanceEventSeq(state: RuntimeState): void {
  eventSequences.set(state, (eventSequences.get(state) ?? 0) + 1);
}

export function derivedEventSeq(state: RuntimeState): number {
  return eventSequences.get(state) ?? Object.keys(state.evidence).length + Object.keys(state.claims).length + Object.keys(state.links).length;
}

/**
 * Canonical key for a Fragment, used for collect idempotence ("Collecting is
 * idempotent per team and artifact plus fragment", §7). Key order inside the
 * fragment object must not matter, so entries are sorted.
 */
export function fragmentKey(fragment: Fragment | undefined): string {
  if (fragment === undefined) return "-";
  const entries = Object.entries(fragment)
    .filter(([key]) => key !== "kind")
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return `${fragment.kind}:${entries.map(([k, v]) => `${k}=${String(v)}`).join(",")}`;
}

/**
 * overlayFs key for a player-created terminal file ("host+path -> content").
 * In-world hostnames never contain ":", so this is injective.
 */
export function overlayKey(host: string, path: string): string {
  return `${host}:${path}`;
}
