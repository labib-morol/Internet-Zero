/**
 * Deterministic layered layout for the evidence board (§11.2 "auto-layout
 * button ... simple layered layout by relation direction — deterministic, no
 * dependency").
 *
 * Links point `from → to` (§7): evidence supports a claim, a claim derives
 * from evidence, and so on — information flows from source to conclusion.
 * Sources land in layer 0 (left), each layer one step right of its
 * predecessors. Rows inside a layer sort by id so the same board always lays
 * out identically.
 */

export interface LayoutLink {
  from: string;
  to: string;
}

export const LAYER_WIDTH = 280;
export const ROW_HEIGHT = 150;
/** Cap for cyclic graphs (mutual same_identity links): keep x bounded. */
const MAX_PASSES = 6;

export function layeredLayout(
  ids: readonly string[],
  links: readonly LayoutLink[]
): Record<string, { x: number; y: number }> {
  const present = new Set(ids);
  const layer: Record<string, number> = {};
  for (const id of ids) layer[id] = 0;

  const edges = links.filter((l) => present.has(l.from) && present.has(l.to) && l.from !== l.to);

  // Relaxation: layer(to) must exceed every layer(from). Converges for DAGs;
  // cycles climb to the pass cap and stop — deterministic either way.
  for (let pass = 0; pass < Math.min(ids.length, MAX_PASSES); pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const next = (layer[edge.from] ?? 0) + 1;
      if (next > (layer[edge.to] ?? 0)) {
        layer[edge.to] = next;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byLayer = new Map<number, string[]>();
  for (const id of ids) {
    const l = layer[id] ?? 0;
    const members = byLayer.get(l) ?? [];
    members.push(id);
    byLayer.set(l, members);
  }

  const result: Record<string, { x: number; y: number }> = {};
  for (const [l, members] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    members.sort();
    members.forEach((id, row) => {
      result[id] = { x: l * LAYER_WIDTH, y: row * ROW_HEIGHT };
    });
  }
  return result;
}
