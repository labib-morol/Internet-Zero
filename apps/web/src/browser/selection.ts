import type { Fragment } from "@iz/schema";

/**
 * Select-then-press-C collect (§11.1): converts a DOM Selection inside the
 * rendered view into a stable character-range fragment by walking text nodes.
 * Offsets are computed against the view container, so the same visual
 * selection always yields the same fragment identity (§7).
 */

export interface SelectionRange {
  start: number;
  end: number;
}

interface TextBounds {
  node: Text;
  start: number;
  end: number;
}

/** Flat map of every text node inside `container` to its character range. */
function textBounds(container: Node): TextBounds[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const bounds: TextBounds[] = [];
  let total = 0;
  let current = walker.nextNode() as Text | null;
  while (current !== null) {
    const len = current.textContent?.length ?? 0;
    bounds.push({ node: current, start: total, end: total + len });
    total += len;
    current = walker.nextNode() as Text | null;
  }
  return bounds;
}

/** Position of a selection boundary (node, offset) in the container stream. */
function boundaryOffset(bounds: TextBounds[], node: Node, offset: number, isEnd: boolean): number | undefined {
  if (node.nodeType === Node.TEXT_NODE) {
    const own = bounds.find((b) => b.node === node);
    if (own === undefined) return undefined;
    return own.start + Math.min(Math.max(0, offset), own.end - own.start);
  }
  // Element boundary: resolve via its children.
  const child = node.childNodes[offset];
  if (isEnd) {
    if (child === undefined) {
      // Offset at/past the end: last text position inside the node.
      return lastTextEndInside(bounds, node);
    }
    // End just before `child`: last text position inside the preceding subtree,
    // falling back to the first position inside the node itself.
    const before = lastTextEndInside(bounds, child) ?? firstTextStartInside(bounds, node);
    return before;
  }
  if (child !== undefined) {
    return firstTextStartInside(bounds, child) ?? lastTextEndInside(bounds, node);
  }
  return lastTextEndInside(bounds, node);
}

function firstTextStartInside(bounds: TextBounds[], node: Node): number | undefined {
  for (const b of bounds) {
    if (node.contains(b.node)) return b.start;
  }
  return undefined;
}

function lastTextEndInside(bounds: TextBounds[], node: Node): number | undefined {
  for (let i = bounds.length - 1; i >= 0; i -= 1) {
    const b = bounds[i]!;
    if (node.contains(b.node)) return b.end;
  }
  return undefined;
}

/** Character range of the selection within `container`, or undefined. */
export function selectionRangeIn(container: Node, selection: Selection): SelectionRange | undefined {
  if (selection.rangeCount === 0 || selection.isCollapsed) return undefined;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return undefined;
  const bounds = textBounds(container);
  if (bounds.length === 0) return undefined;
  const start = boundaryOffset(bounds, range.startContainer, range.startOffset, false);
  const end = boundaryOffset(bounds, range.endContainer, range.endOffset, true);
  if (start === undefined || end === undefined) return undefined;
  return start <= end ? { start, end } : { start: end, end: start };
}

export function rangeFragment(range: SelectionRange): Extract<Fragment, { kind: "range" }> {
  return { kind: "range", start: range.start, end: range.end };
}
