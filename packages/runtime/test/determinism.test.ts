import { describe, expect, it } from "vitest";

/**
 * Belt and suspenders on top of the ESLint determinism rules (§9): scan every
 * runtime source file (loaded as raw text via Vite's import.meta.glob — no
 * filesystem access, which is banned in this package) and assert the forbidden
 * nondeterminism tokens never appear outside comments.
 */
const sources: Record<string, string> = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("determinism self-test (§9)", () => {
  it("loads the runtime sources", () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(10);
  });

  it("never reads the wall clock or randomness in src", () => {
    for (const [file, src] of Object.entries(sources)) {
      const code = stripComments(src);
      expect(code, `${file} must not read the wall clock`).not.toContain("Date.now");
      expect(code, `${file} must not use Math.random`).not.toContain("Math.random");
      expect(code, `${file} must not use crypto.randomUUID`).not.toContain("randomUUID");
    }
  });

  it("never imports banned modules in src", () => {
    const banned = ["child_process", "node:vm", "node:fs", "node:net", "node:dns", "node:http", "node:https", "worker_threads"];
    for (const [file, src] of Object.entries(sources)) {
      const code = stripComments(src);
      for (const mod of banned) {
        expect(code, `${file} must not import ${mod}`).not.toContain(`"${mod}"`);
        expect(code, `${file} must not import ${mod}`).not.toContain(`'${mod}'`);
      }
    }
  });
});
