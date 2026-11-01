import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Security acceptance row §16.1: import-scan test on runtime, services,
 * terminal and mcp. Belt and suspenders alongside the ESLint bans — a test
 * that scans the actual source text, so it holds regardless of lint config.
 */

const PACKAGES = ["runtime", "services", "terminal", "mcp"] as const;

const BANNED_IMPORTS = [
  "child_process",
  "node:child_process",
  "vm",
  "node:vm",
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
  "net",
  "node:net",
  "dns",
  "node:dns",
  "http",
  "node:http",
  "https",
  "node:https",
  "worker_threads",
  "node:worker_threads",
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function stripCommentsAndStrings(src: string): string {
  // Remove block comments, line comments, then template/string literal contents.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, "`")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

describe("security: game-logic packages never import the host", () => {
  for (const pkg of PACKAGES) {
    it(`packages/${pkg} imports no banned modules`, () => {
      const dir = join("packages", pkg, "src");
      const files = listTsFiles(dir);
      expect(files.length, `${pkg} has source files`).toBeGreaterThan(0);
      const offenders: string[] = [];
      for (const file of files) {
        const code = stripCommentsAndStrings(readFileSync(file, "utf8"));
        const importRe = /(?:^|[\s;}])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;
        let m: RegExpExecArray | null;
        while ((m = importRe.exec(code)) !== null) {
          const spec = m[1] ?? m[2] ?? m[3] ?? "";
          if (BANNED_IMPORTS.includes(spec)) offenders.push(`${file}: ${spec}`);
        }
        if (/\beval\s*\(/.test(code) || /\bnew\s+Function\s*\(/.test(code)) {
          offenders.push(`${file}: dynamic code execution (eval / new Function)`);
        }
        if (/\bfetch\s*\(/.test(code)) offenders.push(`${file}: fetch()`);
      }
      expect(offenders, offenders.join("\n")).toEqual([]);
    });
  }
});
