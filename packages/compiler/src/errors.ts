/**
 * Build issues and the aggregate error thrown by compileWorld.
 *
 * Every issue carries the number of the build check it belongs to (master
 * prompt section 6.5, checks 1-12) plus the source file (and, where useful,
 * the object id) it came from.
 */
import { MarkdownError, ServiceError } from "@iz/services";

export type BuildIssue = {
  /** 1-12: which of the build-time checks failed (section 6.5). */
  check: number;
  /** Source file the issue came from, relative to the world source dir. */
  file: string;
  /** Object id involved, when known. */
  id?: string;
  message: string;
};

export class BuildError extends Error {
  readonly issues: readonly BuildIssue[];

  constructor(issues: readonly BuildIssue[]) {
    if (issues.length === 0) throw new Error("BuildError requires at least one issue");
    const first = issues[0]!;
    super(
      issues.length === 1
        ? `check ${first.check} failed in ${first.file}${first.id ? ` (${first.id})` : ""}: ${first.message}`
        : `${issues.length} build checks failed; first: check ${first.check} in ${first.file}: ${first.message}`,
    );
    this.name = "BuildError";
    this.issues = issues;
  }

  /** The check number of the first (lowest, then file-sorted) issue. */
  get check(): number {
    return this.issues[0]!.check;
  }
}

/** Deterministic issue order: by check number, then file, then id, then message. */
export function sortIssues(issues: readonly BuildIssue[]): BuildIssue[] {
  return [...issues].sort((a, b) => a.check - b.check || a.file.localeCompare(b.file) || (a.id ?? "").localeCompare(b.id ?? "") || a.message.localeCompare(b.message));
}

/**
 * Maps a services-package error to a build issue: markdown safety/allowlist
 * violations are check 11, malformed markers check 1, link/image resolution
 * check 2, and ServiceError carries its own check number.
 */
export function issueFromError(error: unknown, file: string): BuildIssue {
  if (error instanceof MarkdownError) {
    const check = error.kind === "safety" || error.kind === "allowlist" ? 11 : error.kind === "marker" ? 1 : 2;
    return { check, file, message: error.message };
  }
  if (error instanceof ServiceError) {
    return { check: error.check, file, message: error.message };
  }
  throw error;
}
