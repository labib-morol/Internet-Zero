import type { RuntimeState, WorldBundle } from "@iz/schema";

/**
 * The world is complete when every bundle gate is solved AND every report the
 * world declares (world.reports) has at least one accepted group.
 */
export function isWorldComplete(bundle: WorldBundle, state: RuntimeState): boolean {
  const gatesSolved = bundle.gates.every((g) => state.solvedGates[g.id] !== undefined);
  const reportsAccepted = bundle.world.reports.every(
    (reportId) => (state.reportGroupsAccepted[reportId]?.length ?? 0) >= 1
  );
  return gatesSolved && reportsAccepted;
}
