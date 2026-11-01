import type { BundleGate, RuntimeState, WorldBundle } from "@iz/schema";
import { evaluateCondition } from "./conditions.js";
import { hostReachable, type IsUnlocked } from "./visibility.js";

/**
 * mustLink endpoint matching. An authored triple id refers to an artifact (the
 * only stable id a world author can know); a link endpoint matches when it IS
 * that id, or when it is an evidence item collected FROM that artifact.
 * Literal evidence/claim ids also match directly, which keeps the check usable
 * with hand-authored logs. (Documented §7 interpretation: "evidenceSet gate
 * checks compare collected artifact ids and link triples".)
 */
function endpointRefersTo(linkEndpoint: string, targetId: string, state: RuntimeState): boolean {
  if (linkEndpoint === targetId) return true;
  return state.evidence[linkEndpoint]?.artifactId === targetId;
}

/**
 * Implicit-gate satisfaction for one gate at one instant. Answer gates are
 * never implicit (only submitAnswer solves them). The gate's own `requires`
 * gates implicit solving too, per §8 ("a gate is available when its requires
 * condition is true") — an unavailable implicit gate simply stays unsolved
 * until its requires holds.
 */
export function implicitGateSatisfied(
  bundle: WorldBundle,
  gate: BundleGate,
  state: RuntimeState,
  isUnlocked: IsUnlocked,
  now: string
): boolean {
  // Const local so TypeScript keeps the discriminated-union narrowing inside
  // the callbacks below (parameters lose narrowing in closures).
  const check = gate.check;
  if (check.kind === "answer") return false;
  if (gate.requires !== undefined && !evaluateCondition(gate.requires, state, bundle, now)) return false;
  switch (check.kind) {
    case "terminal": {
      const hostDef = bundle.world.hosts.find((h) => h.host === check.host);
      if (hostDef === undefined || !hostReachable(bundle, hostDef, state, isUnlocked, now)) return false;
      const read = state.readPaths[check.host];
      if (read === undefined) return false;
      return check.mustHaveRead.every((p) => read.has(p));
    }
    case "evidenceSet": {
      const hasEvidenceFrom = (artifactId: string): boolean =>
        Object.values(state.evidence).some((e) => e.artifactId === artifactId);
      if (!check.mustCollect.every(hasEvidenceFrom)) return false;
      const links = Object.values(state.links);
      return check.mustLink.every(
        (triple) =>
          links.some(
            (l) =>
              l.relation === triple.relation &&
              endpointRefersTo(l.from, triple.from, state) &&
              endpointRefersTo(l.to, triple.to, state)
          )
      );
    }
    case "report":
      return (state.reportGroupsAccepted[check.report]?.length ?? 0) >= 1;
  }
}

/**
 * fold-side implicit-gate pass (§9). Runs to fixpoint over the FINAL replayed
 * state: solving a gate adds unlocks, which can make a terminal gate's host
 * reachable, and requires-conditions may chain. Solving is monotone, so the
 * fixpoint is unique and deterministic. apply() runs its own emitting fixpoint
 * at the start of every apply; fold's pass materializes gates that the log's
 * tail satisfied without a subsequent apply (using the last event's at/by).
 */
export function finalizeImplicitGates(bundle: WorldBundle, state: RuntimeState, now: string, by: string): void {
  const isUnlocked: IsUnlocked = (id) => state.unlocked.has(id);
  let changed = true;
  let guard = 0;
  while (changed && guard <= bundle.gates.length + 1) {
    changed = false;
    guard += 1;
    for (const gate of bundle.gates) {
      if (state.solvedGates[gate.id] !== undefined) continue;
      if (!implicitGateSatisfied(bundle, gate, state, isUnlocked, now)) continue;
      state.solvedGates[gate.id] = { at: now, by };
      for (const id of gate.unlocks) state.unlocked.add(id);
      state.score += gate.score;
      changed = true;
    }
  }
}
