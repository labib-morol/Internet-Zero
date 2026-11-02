import type { RuntimeState, WorldBundle } from "@iz/schema";

/**
 * The world is complete when every bundle gate is solved AND every report the
 * world declares (world.reports) has at least one accepted group.
 */
export function isWorldComplete(bundle: WorldBundle, state: RuntimeState): boolean {
  const gatesSolved = bundle.gates.every((g) => state.solvedGates[g.id] !== undefined);
  const reportsAccepted = bundle.world.reports.every((reportId) => {
    const report = bundle.reports.find((r) => r.id === reportId);
    return report !== undefined && report.groups.every((g) => (state.reportGroupsAccepted[reportId] ?? []).includes(g.id));
  });
  const endings = bundle.artifacts.filter((a) => a.kind === 'terminal-file' && a.meta.completion === 'terminalRead');
  const endingRead = endings.every((a) => [...(state.readPaths[a.host] ?? [])].some((p) => p.replace(/^\/+/, '') === a.path.replace(/^\/+/, '')));
  return gatesSolved && reportsAccepted && endingRead;
}
