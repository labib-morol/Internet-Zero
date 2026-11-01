import type { Artifact, HostDef, RuntimeState, WorldBundle } from "@iz/schema";
import { evaluateCondition } from "./conditions.js";

/** Membership test against `unlocked`, overlay-aware inside apply (see apply). */
export type IsUnlocked = (id: string) => boolean;

/**
 * Host reachability. Both mechanisms from the spec coexist:
 * - a host whose id is in `unlocked` (gate.unlocks or a revealHosts effect) is
 *   reachable, bypassing its `requires` condition;
 * - a host with NO `requires` is always reachable (that is why `unlocked`
 *   starts empty — reachability of entry hosts is computed from the world, not
 *   stored);
 * - a host with `requires` is reachable exactly when the condition holds.
 */
export function hostReachable(
  bundle: WorldBundle,
  hostDef: HostDef,
  state: RuntimeState,
  isUnlocked: IsUnlocked,
  now: string
): boolean {
  if (isUnlocked(hostDef.host)) return true;
  if (hostDef.requires === undefined) return true;
  return evaluateCondition(hostDef.requires, state, bundle, now);
}

/**
 * Artifact ids that the world explicitly gates behind an unlock: they appear in
 * some gate's `unlocks` or in some world-event effect that unlocks an artifact
 * (deliverMail.message, reveal.artifact, addCommit.commit). Everything else
 * follows plain host + visibility-condition rules.
 *
 * The bundle is treated as immutable after load (the compiler produces it), so
 * the result is cached per bundle object.
 */
const unlockGatedCache = new WeakMap<WorldBundle, Set<string>>();
export function unlockGatedArtifactIds(bundle: WorldBundle): Set<string> {
  const cached = unlockGatedCache.get(bundle);
  if (cached !== undefined) return cached;
  const ids = new Set<string>();
  for (const gate of bundle.gates) {
    for (const id of gate.unlocks) ids.add(id);
  }
  for (const def of bundle.events) {
    for (const effect of def.effects) {
      if (effect.kind === "reveal") ids.add(effect.artifact);
      else if (effect.kind === "deliverMail") ids.add(effect.message);
      else if (effect.kind === "addCommit") ids.add(effect.commit);
    }
  }
  unlockGatedCache.set(bundle, ids);
  return ids;
}

/**
 * Artifact visibility (§7, §9, §10: "The server calls `view` only after
 * checking the host and artifact visibility").
 *
 * An artifact is visible when its host is reachable AND one of:
 * - it has no `visibility` condition and the world does not gate its id behind
 *   an unlock (the default: visible as soon as its host is);
 * - it has no `visibility` condition but was explicitly unlocked (gate.unlocks
 *   or a world-event effect) — this is what makes reveal/deliverMail/addCommit
 *   actually reveal something;
 * - its `visibility` condition holds (or it was unlocked, whichever first —
 *   authored reveals are deliberate and take effect immediately).
 */
export function artifactVisible(
  bundle: WorldBundle,
  artifact: Artifact,
  state: RuntimeState,
  isUnlocked: IsUnlocked,
  now: string
): boolean {
  const hostDef = bundle.world.hosts.find((h) => h.host === artifact.host);
  if (hostDef === undefined) return false;
  if (!hostReachable(bundle, hostDef, state, isUnlocked, now)) return false;
  const unlocked = isUnlocked(artifact.id);
  if (artifact.visibility === undefined) {
    return !unlockGatedArtifactIds(bundle).has(artifact.id) || unlocked;
  }
  return unlocked || evaluateCondition(artifact.visibility, state, bundle, now);
}

/** Server helper: every artifact the team may currently see (deterministic). */
export function visibleArtifacts(bundle: WorldBundle, state: RuntimeState, now: string): Artifact[] {
  const isUnlocked: IsUnlocked = (id) => state.unlocked.has(id);
  return bundle.artifacts.filter((a) => artifactVisible(bundle, a, state, isUnlocked, now));
}

/** First artifact published at (host, path) in bundle order. */
export function findArtifactAt(bundle: WorldBundle, host: string, path: string): Artifact | undefined {
  return bundle.artifacts.find((a) => a.host === host && a.path === path);
}
