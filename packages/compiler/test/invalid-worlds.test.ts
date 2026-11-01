import { describe, expect, it } from "vitest";
import { compileWorld, BuildError } from "../src/index.js";
import { TEST_SALT, cleanup, mutatedWorld, type Mutation } from "./helpers.js";

/**
 * One invalid world per build check (master prompt section 6.5). Each is the
 * valid fixture world with exactly one targeted mutation, so the build must
 * fail with ONLY that check's issues.
 */
const CASES: Array<{ check: number; name: string; mutations: Mutation[]; options?: { dropAssets?: boolean } }> = [
  {
    check: 1,
    name: "schema violation: unknown key on a fact",
    mutations: [
      {
        file: "facts.yaml",
        append: '- id: f.broken\n  proposition: { subject: o.printer, predicate: broken, object: "x" }\n  typoKey: oops\n',
      },
    ],
  },
  {
    check: 2,
    name: "dangling reference: hint points at an unknown gate",
    mutations: [{ file: "hints.yaml", append: '- gate: g.nope\n  tier: 1\n  text: "Broken reference."\n  cost: 1\n' }],
  },
  {
    check: 3,
    name: "contradictory facts: same subject+predicate, different object",
    mutations: [
      {
        file: "facts.yaml",
        append: "- id: f.reset-by-2\n  proposition: { subject: o.printer, predicate: resetBy, object: p.jamie }\n  required: false\n",
      },
    ],
  },
  {
    check: 4,
    name: "truthful statement references a fact with a different proposition",
    mutations: [{ file: "statements.yaml", replace: ["fact: f.reset-date", "fact: f.printer-pass"] }],
  },
  {
    check: 5,
    name: "lie without any reachable contradicting artifact",
    mutations: [
      { file: "services/forge/acme-notes.yaml", replace: ["Rotate floor-2 printer admin password (approved by Mara Voss)", "Rotate floor-2 printer admin password"] },
      { file: "services/forge/acme-notes.yaml", replace: ['name: "Mara Voss"', 'name: "M. Voss"'] },
      { file: "services/forge/acme-notes.yaml", replace: ["      - author: id.mara-git\n        date:", "      - author: id.jamie-git\n        date:"] },
      { file: "services/archive/printer-log.md", replace: ["rotated by Mara Voss (office manager)", "rotated by the office manager"] },
    ],
  },
  {
    check: 6,
    name: "required fact without a direct proof",
    mutations: [
      {
        file: "proofs.yaml",
        replace: ["- fact: f.reset-by\n  artifacts: [a.5f2e6a1b3c4d5e6f708192a3b4c5d6e7f8091a2b]\n  strength: direct", "- fact: f.reset-by\n  artifacts: [a.5f2e6a1b3c4d5e6f708192a3b4c5d6e7f8091a2b]\n  strength: corroborating"],
      },
    ],
  },
  {
    check: 7,
    name: "gate requirement cycle: g.report requires itself",
    mutations: [{ file: "gates.yaml", replace: ["requires: { all: [{ gateSolved: g.files }] }", "requires: { gateSolved: g.report }"] }],
  },
  {
    check: 8,
    name: "report slot answer does not match the fact object",
    mutations: [{ file: "reports.yaml", replace: ['answers: ["2026-10-28"]', 'answers: ["2026-10-29"]'] }],
  },
  {
    check: 9,
    name: "gate without a tier-3 hint",
    mutations: [{ file: "hints.yaml", replace: ["\n- gate: g.first-commit\n  tier: 3\n  text: \"The answer is the full sha of that commit.\"\n  cost: 50", ""] }],
  },
  {
    check: 10,
    name: "text artifact over the 256 KB size limit",
    mutations: [
      {
        file: "services/terminal/fs/term.fix.pcp/etc/printers.conf",
        replace: ["admin_password=papercut-7331\n", `admin_password=papercut-7331\n# ${"x".repeat(300 * 1024)}\n`],
      },
    ],
  },
  {
    check: 11,
    name: "raw HTML in world content",
    mutations: [
      {
        file: "services/forge/acme-notes.yaml",
        replace: ["  [[stamp:ACME INTERNAL]]\nbranches:", "  [[stamp:ACME INTERNAL]]\n  <script>alert(1)</script>\nbranches:"],
      },
    ],
  },
  {
    check: 12,
    name: "hostSuffix is a real TLD",
    mutations: [{ file: "world.yaml", replace: ["hostSuffix: pcp", "hostSuffix: com"] }],
  },
];

describe("invalid fixture worlds (one per build check)", () => {
  for (const testCase of CASES) {
    it(`check ${testCase.check}: ${testCase.name}`, async () => {
      const dir = await mutatedWorld(testCase.mutations, testCase.options);
      try {
        let caught: unknown;
        try {
          await compileWorld(dir, { salt: TEST_SALT });
          expect.unreachable(`expected the build to fail for check ${testCase.check}`);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(BuildError);
        const buildError = caught as BuildError;
        expect(buildError.issues.length).toBeGreaterThan(0);
        expect(buildError.issues.map((issue) => issue.check)).toEqual(Array(buildError.issues.length).fill(testCase.check));
        expect(buildError.check).toBe(testCase.check);
      } finally {
        await cleanup(dir);
      }
    });
  }
});
