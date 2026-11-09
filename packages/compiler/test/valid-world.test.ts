import { describe, expect, it } from "vitest";
import { WorldBundle, normalizeAnswer } from "@iz/schema";
import { hashAnswer } from "@iz/runtime";
import { compileWorld, canonicalJson, computeBundleHash } from "../src/index.js";
import { FIXTURE_DIR, TEST_SALT, cleanup, mutatedWorld } from "./helpers.js";

const SHA = "5f2e6a1b3c4d5e6f708192a3b4c5d6e7f8091a2b";

describe("compileWorld on the valid fixture world", () => {
  it("compiles and produces a schema-valid WorldBundle", async () => {
    const { bundle } = await compileWorld(FIXTURE_DIR, { salt: TEST_SALT });
    const parsed = WorldBundle.safeParse(bundle);
    expect(parsed.success).toBe(true);
    expect(bundle.world.id).toBe("fixture");
    expect(bundle.bundleSalt).toBe(TEST_SALT);
  });

  it("computes bundleHash over the canonical JSON without the hash field", async () => {
    const { bundle } = await compileWorld(FIXTURE_DIR, { salt: TEST_SALT });
    expect(bundle.bundleHash).toMatch(/^[0-9a-f]{64}$/);
    const { bundleHash: _omitted, ...rest } = bundle;
    expect(computeBundleHash(rest)).toBe(bundle.bundleHash);
  });

  it("replaces plaintext answers with salted hashes everywhere", async () => {
    const { bundle } = await compileWorld(FIXTURE_DIR, { salt: TEST_SALT });
    const gatesAndReports = JSON.stringify({ gates: bundle.gates, reports: bundle.reports });

    // No plaintext answers survive in the gates/reports sections (they do exist
    // as discoverable world content, which is the point of a findable answer).
    expect(gatesAndReports).not.toContain('"answers"');
    for (const plaintext of [SHA, "papercut-7331", "Mara Voss", "p.mara", "2026-10-28"]) {
      expect(gatesAndReports).not.toContain(plaintext);
    }

    const answerGate = bundle.gates.find((g) => g.id === "g.first-commit")!;
    expect(answerGate.check.kind).toBe("answer");
    if (answerGate.check.kind !== "answer") throw new Error("unreachable");
    expect(answerGate.check.answerHashes).toHaveLength(1);
    expect(answerGate.check.answerHashes[0]).toBe(hashAnswer(TEST_SALT, "g.first-commit", normalizeAnswer(SHA, answerGate.check.normalize)));

    const slot = bundle.reports[0]!.groups[0]!.slots.find((s) => s.id === "slot.culprit")!;
    expect(slot).not.toHaveProperty("answers");
    expect(slot.answerHashes).toHaveLength(2);
    const steps = ["nfkc", "lower", "trim", "collapse"] as const;
    expect(slot.answerHashes).toContain(hashAnswer(TEST_SALT, "slot.culprit", normalizeAnswer("Mara Voss", steps)));
    expect(slot.answerHashes).toContain(hashAnswer(TEST_SALT, "slot.culprit", normalizeAnswer("p.mara", steps)));
  });

  it("is deterministic for a fixed salt and salt-sensitive overall", async () => {
    const a = await compileWorld(FIXTURE_DIR, { salt: TEST_SALT });
    const b = await compileWorld(FIXTURE_DIR, { salt: TEST_SALT });
    expect(a.bundleJson).toBe(b.bundleJson);
    expect(a.bundle.bundleHash).toBe(b.bundle.bundleHash);

    const c = await compileWorld(FIXTURE_DIR, { salt: "fedcba9876543210fedcba9876543210" });
    expect(c.bundle.bundleHash).not.toBe(a.bundle.bundleHash);
    expect(c.bundle.gates[0]!.check).not.toEqual(a.bundle.gates[0]!.check);
  });

  it("compiles every service into artifacts with the right ids, kinds and collectible flags", async () => {
    const { bundle, report } = await compileWorld(FIXTURE_DIR, { salt: TEST_SALT });
    const kinds = report.counts.artifactsByKind;
    expect(kinds.repo).toBe(1);
    expect(kinds.commit).toBe(1);
    expect(kinds.issue).toBe(1);
    expect(kinds.user).toBe(2);
    expect(kinds["mail-message"]).toBe(3);
    expect(kinds["archive-document"]).toBe(1);
    expect(kinds["terminal-file"]).toBe(2);

    const commit = bundle.artifacts.find((a) => a.id === `a.${SHA}`)!;
    expect(commit.kind).toBe("commit");
    expect(commit.collectible).toBe(true);
    expect(commit.host).toBe("forge.fix.pcp");

    const message = bundle.artifacts.find((a) => a.id === "a.m-lie")!;
    expect(message.collectible).toBe(true);
    expect(message.path).toBe("a.mbox-jamie/inbox/a.m-lie");

    const conf = bundle.artifacts.find((a) => a.id === "a.term.fix.pcp.etc-printers.conf")!;
    expect(conf.kind).toBe("terminal-file");
    expect(conf.body).toContain("papercut-7331");
    expect(conf.collectible).toBe(false);
    expect(conf.meta.motd).toBe("NODE TERMINAL — authorized staff only");
  });

  it("content-addresses assets and rewrites image and attachment references", async () => {
    const { bundle } = await compileWorld(FIXTURE_DIR, { salt: TEST_SALT });
    expect(bundle.assets).toHaveLength(1);
    const asset = bundle.assets[0]!;
    expect(asset.id).toBe(asset.sha256);
    expect(asset.contentType).toBe("image/png");
    expect(asset.bytes).toBeGreaterThan(0);

    const doc = bundle.artifacts.find((a) => a.id === "a.doc-log")!;
    const image = findNode(doc.ast, (n) => n.type === "image");
    expect(image).toMatchObject({ type: "image", url: asset.sha256 });

    const lie = bundle.artifacts.find((a) => a.id === "a.m-lie")!;
    const attachments = JSON.parse(String(lie.meta.attachments)) as Array<{ asset: string }>;
    expect(attachments[0]!.asset).toBe(asset.sha256);
  });

  it("parses all four custom marker kinds into safe AST nodes", async () => {
    const { bundle } = await compileWorld(FIXTURE_DIR, { salt: TEST_SALT });
    const readme = bundle.artifacts.find((a) => a.id === "a.notes")!;
    const types = new Set<string>();
    collectTypes(readme.ast, types);
    expect(types.has("redaction")).toBe(true);
    expect(types.has("signature")).toBe(true);
    expect(types.has("stamp")).toBe(true);
    const fixed = findNode(readme.ast, (n) => n.type === "redaction");
    // FIXED redactions are hidden forever: their text is dropped at compile
    // time so it can never reach a client through the serialized AST.
    expect(fixed).toMatchObject({ type: "redaction", removable: false, text: "" });
    expect(readme.body).not.toContain("rotated by the vendor technician");

    const lie = bundle.artifacts.find((a) => a.id === "a.m-lie")!;
    const removable = findNode(lie.ast, (n) => n.type === "redaction");
    expect(removable).toMatchObject({ type: "redaction", removable: true, text: "HR case number" });

    // Redacted text never leaks into the searchable body.
    expect(lie.body).not.toContain("HR case number");
    expect(lie.body).toContain("[REDACTED]");
  });

  it("derives visibility from gate unlocks and event triggers, and solves every gate in the simulation", async () => {
    const { bundle, report } = await compileWorld(FIXTURE_DIR, { salt: TEST_SALT });
    expect(report.reachability.solvedGates).toEqual(["g.files", "g.first-commit", "g.report"]);
    expect(report.reachability.reachableHosts).toEqual(["archive.fix.pcp", "forge.fix.pcp", "mail.fix.pcp", "term.fix.pcp"]);
    // Every artifact is reachable in this world.
    for (const artifact of bundle.artifacts) {
      expect(report.reachability.reachableArtifacts).toContain(artifact.id);
    }
    // The event-delivered message carries a visibility condition.
    const delivered = bundle.artifacts.find((a) => a.id === "a.m-003")!;
    expect(delivered.visibility).toEqual({ gateSolved: "g.files" });
  });

  it("emits warnings for the statically-listed delivered message and reports counts", async () => {
    const { report } = await compileWorld(FIXTURE_DIR, { salt: TEST_SALT });
    expect(report.warnings.some((w) => w.includes("a.m-003") && w.includes("statically"))).toBe(true);
    expect(report.counts.gates).toBe(3);
    expect(report.counts.facts).toBe(3);
    expect(report.counts.hints).toBe(9);
  });

  it("handles worlds with zero assets", async () => {
    const dir = await mutatedWorld([], { dropAssets: true });
    try {
      const { bundle } = await compileWorld(dir, { salt: TEST_SALT });
      expect(bundle.assets).toEqual([]);
      const doc = bundle.artifacts.find((a) => a.id === "a.doc-log")!;
      expect(findNode(doc.ast, (n) => n.type === "image")).toBeUndefined();
    } finally {
      await cleanup(dir);
    }
  });

  it("canonicalJson sorts keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: true } })).toBe('{"a":{"c":true,"d":[2,1]},"b":1}');
  });
});

function collectTypes(node: { type: string; children?: unknown[] }, out: Set<string>): void {
  out.add(node.type);
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (child && typeof child === "object" && "type" in child) collectTypes(child as { type: string; children?: unknown[] }, out);
    }
  }
}

function findNode<T extends { type: string }>(ast: { type: string; children?: unknown[] }, predicate: (node: T) => boolean): T | undefined {
  if (predicate(ast as T)) return ast as T;
  for (const child of ast.children ?? []) {
    if (child && typeof child === "object" && "type" in child) {
      const found = findNode(child as { type: string; children?: unknown[] }, predicate);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
