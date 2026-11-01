import type { Cond, RuntimeState, WorldBundle } from "@iz/schema";
import { worldTimeMs } from "./time.js";

/**
 * Progression-condition evaluation (§6.3, §8: "A gate is available when its
 * `requires` condition is true for the team state"). Pure: reads only the
 * folded state, the bundle and the injected `now`.
 *
 * Interpretations of the Cond variants that the frozen schema leaves open:
 * - `evidenceCollected: a.x` is satisfied when the team has ANY evidence item
 *   collected from artifact `a.x` (worlds cannot author runtime-generated
 *   evidence ids, so the condition must reference the artifact). Archived
 *   evidence still counts: collecting happened, archiving only hides the card.
 * - `factEstablished: f.x` is satisfied when an accepted report group contains
 *   a slot whose `fact` is `f.x`. Accepting report groups is the only
 *   team-driven way to establish canon facts in v1.
 * - `timeReached` compares against WORLD time (§13): epoch + (now - startedAt)
 *   in session mode, `now` itself in global mode.
 * - `teamSizeAtLeast` cannot be derived from the event log (there are no
 *   membership events), so it evaluates conservatively: true for <= 1 (a solo
 *   player is a team of one, §12), false otherwise. Worlds that need bigger
 *   teams must not rely on this condition in v1.
 */
export function evaluateCondition(cond: Cond, state: RuntimeState, bundle: WorldBundle, now: string): boolean {
  if ("all" in cond) return cond.all.every((c) => evaluateCondition(c, state, bundle, now));
  if ("any" in cond) return cond.any.some((c) => evaluateCondition(c, state, bundle, now));
  if ("not" in cond) return !evaluateCondition(cond.not, state, bundle, now);
  if ("gateSolved" in cond) return state.solvedGates[cond.gateSolved] !== undefined;
  if ("evidenceCollected" in cond) {
    return Object.values(state.evidence).some((e) => e.artifactId === cond.evidenceCollected);
  }
  if ("factEstablished" in cond) {
    for (const [reportId, groupIds] of Object.entries(state.reportGroupsAccepted)) {
      const report = bundle.reports.find((r) => r.id === reportId);
      if (report === undefined) continue;
      for (const groupId of groupIds) {
        const group = report.groups.find((g) => g.id === groupId);
        if (group === undefined) continue;
        if (group.slots.some((slot) => slot.fact === cond.factEstablished)) return true;
      }
    }
    return false;
  }
  if ("timeReached" in cond) {
    const worldMs = worldTimeMs(bundle, state, now);
    const targetMs = Date.parse(cond.timeReached);
    if (worldMs === undefined || Number.isNaN(targetMs)) return false;
    return worldMs >= targetMs;
  }
  if ("teamSizeAtLeast" in cond) {
    return cond.teamSizeAtLeast <= 1;
  }
  return false;
}
