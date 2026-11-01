/**
 * Unified diff computation for the GIT//FORGE commit detail view (§10.2).
 * The server sends change records as {path, kind, before?, after?} strings;
 * rendering a real +/- diff for `modify` changes needs line-level comparison,
 * which is presentation logic and therefore client-side. Never executed,
 * only displayed.
 */

export type DiffLineKind = "ctx" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface DiffHunk {
  /** 1-based start line in the "before" file (0 when absent). */
  beforeStart: number;
  /** 1-based start line in the "after" file (0 when absent). */
  afterStart: number;
  lines: DiffLine[];
}

const CONTEXT = 3;

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  // A trailing newline produces a final empty element; it is not a line.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** LCS backtrack table via dynamic programming (files here are small). */
function lcsTable(a: string[], b: string[]): Uint32Array {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const diag = table[(i + 1) * width + (j + 1)]!;
      const down = table[(i + 1) * width + j]!;
      const right = table[i * width + (j + 1)]!;
      table[i * width + j] = a[i] === b[j] ? diag + 1 : Math.max(down, right);
    }
  }
  return table;
}

/** Full line-level edit script (no hunks yet): ctx/add/del in order. */
function editScript(before: string[], after: string[]): DiffLine[] {
  const width = after.length + 1;
  const table = lcsTable(before, after);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    const a = before[i]!;
    const b = after[j]!;
    if (a === b) {
      lines.push({ kind: "ctx", text: a });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + (j + 1)]!) {
      lines.push({ kind: "del", text: a });
      i += 1;
    } else {
      lines.push({ kind: "add", text: b });
      j += 1;
    }
  }
  while (i < before.length) {
    lines.push({ kind: "del", text: before[i]! });
    i += 1;
  }
  while (j < after.length) {
    lines.push({ kind: "add", text: after[j]! });
    j += 1;
  }
  return lines;
}

/**
 * Group an edit script into hunks with `CONTEXT` lines of surrounding context,
 * like a minimal `diff -u`. Changes separated by more than 2·CONTEXT context
 * lines split into separate hunks; closer changes share one.
 */
function toHunks(script: DiffLine[]): DiffHunk[] {
  const changedAt: number[] = [];
  for (let i = 0; i < script.length; i += 1) {
    if (script[i]!.kind !== "ctx") changedAt.push(i);
  }
  if (changedAt.length === 0) return [];

  // Cluster changed indices: a gap of more than 2·CONTEXT+1 context lines
  // cannot be covered by the context windows of both sides, so split there.
  const clusters: Array<[number, number]> = [];
  let first = changedAt[0]!;
  let last = first;
  for (const idx of changedAt.slice(1)) {
    if (idx - last > 2 * CONTEXT + 1) {
      clusters.push([first, last]);
      first = idx;
    }
    last = idx;
  }
  clusters.push([first, last]);

  const hunks: DiffHunk[] = [];
  for (const [changeStart, changeEnd] of clusters) {
    const start = Math.max(0, changeStart - CONTEXT);
    const end = Math.min(script.length - 1, changeEnd + CONTEXT);
    let beforeStart = 1;
    let afterStart = 1;
    for (let k = 0; k < start; k += 1) {
      if (script[k]!.kind === "del") beforeStart += 1;
      else if (script[k]!.kind === "add") afterStart += 1;
      else {
        beforeStart += 1;
        afterStart += 1;
      }
    }
    hunks.push({
      beforeStart,
      afterStart,
      lines: script.slice(start, end + 1).map((l) => ({ ...l })),
    });
  }
  return hunks;
}

export interface FileDiff {
  hunks: DiffHunk[];
  /** True when the two versions are line-identical (no visual diff to show). */
  empty: boolean;
}

/** Unified diff of two file versions. */
export function unifiedDiff(before: string, after: string): FileDiff {
  const script = editScript(splitLines(before), splitLines(after));
  const changed = script.some((l) => l.kind !== "ctx");
  if (!changed) return { hunks: [], empty: true };
  return { hunks: toHunks(script), empty: false };
}

/** Whole-file diff used for add (all +) and delete (all -) changes. */
export function wholeFileDiff(kind: "add" | "del", text: string): FileDiff {
  const lines = splitLines(text).map((l): DiffLine => ({ kind, text: l }));
  if (lines.length === 0) return { hunks: [], empty: true };
  return {
    hunks: [{ beforeStart: kind === "del" ? 1 : 0, afterStart: kind === "add" ? 1 : 0, lines }],
    empty: false,
  };
}
