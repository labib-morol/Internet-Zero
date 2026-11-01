import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { SlotNormalizers, WorldBundle, normalizeAnswer } from "@iz/schema";
import type { Asset, BundleGate, BundleGateCheck, BundleReport, BundleReportSlot, WorldBundle as WorldBundleT } from "@iz/schema";
import { hashAnswer } from "@iz/runtime";
import { scanAssets } from "./assets.js";
import { artifactize } from "./artifactize.js";
import { runChecks } from "./checks.js";
import { BuildError, sortIssues } from "./errors.js";
import { computeBundleHash } from "./hashes.js";
import { IssueCollector, loadWorldSource } from "./source.js";
import type { WorldSourceFiles } from "./source.js";
import type { ReachTree } from "./reach.js";

/**
 * compileWorld: the whole build pipeline.
 *
 *   load + schema-validate (check 1) -> assets -> artifactize (markdown +
 *   service loaders) -> checks 2..12 -> answer hashing -> bundleHash -> report.
 *
 * Throws BuildError (all issues sorted by check/file) when any check fails.
 * Deterministic given the same salt: pass `salt` for reproducible builds,
 * omit it for a random 16-byte salt.
 */

export const MAX_BUNDLE_BYTES = 50 * 1024 * 1024; // build check 10

export type BuildReport = {
  world: { id: string; version: string; title: string; bundleHash: string; bundleSalt: string };
  counts: {
    artifacts: number;
    artifactsByKind: Record<string, number>;
    entities: number;
    identities: number;
    facts: number;
    beliefs: number;
    statements: number;
    proofs: number;
    gates: number;
    reports: number;
    hints: number;
    events: number;
    assets: number;
  };
  reachability: ReachTree;
  warnings: string[];
};

export type CompileResult = {
  bundle: WorldBundleT;
  /** Pretty-printed bundle JSON, exactly what gets written to disk. */
  bundleJson: string;
  report: BuildReport;
};

export async function compileWorld(sourceDir: string, options: { salt?: string } = {}): Promise<CompileResult> {
  const dir = resolve(sourceDir);
  try {
    await stat(dir);
  } catch {
    throw new Error(`world source directory not found: ${dir}`);
  }
  const source = await loadWorldSource(dir); // check 1 (throws BuildError)
  const collector = new IssueCollector();

  const assets = await scanAssets(dir, collector); // asset size limits (check 10)

  const { artifacts, warnings } = artifactize(source, assets); // markdown + service loaders
  collector.throwIfAny();

  const checks = runChecks(source, artifacts, assets);
  const issues = sortIssues([...collector.issues, ...checks.issues]);
  if (issues.length > 0) throw new BuildError(issues);

  const salt = options.salt ?? randomBytes(16).toString("hex");
  if (!/^[0-9a-f]{16,}$/.test(salt)) {
    throw new BuildError([{ check: 1, file: "(options)", message: `salt must be at least 16 hex characters, got "${salt}"` }]);
  }

  const bundle = assembleBundle(source, artifacts, assets.records, salt);

  const bundleJson = JSON.stringify(bundle, null, 2);

  const bundleBytes = Buffer.byteLength(bundleJson, "utf8");
  if (bundleBytes > MAX_BUNDLE_BYTES) {
    throw new BuildError([{ check: 10, file: "(bundle)", message: `compiled bundle is ${bundleBytes} bytes; the limit is ${MAX_BUNDLE_BYTES}` }]);
  }

  const verified = WorldBundle.safeParse(bundle);
  if (!verified.success) {
    const detail = verified.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ");
    throw new Error(`internal error: compiled bundle failed schema validation: ${detail}`);
  }

  const artifactsByKind: Record<string, number> = {};
  for (const artifact of artifacts) artifactsByKind[artifact.kind] = (artifactsByKind[artifact.kind] ?? 0) + 1;

  const report: BuildReport = {
    world: { id: bundle.world.id, version: bundle.world.version, title: bundle.world.title, bundleHash: bundle.bundleHash, bundleSalt: salt },
    counts: {
      artifacts: artifacts.length,
      artifactsByKind,
      entities: bundle.entities.length,
      identities: bundle.identities.length,
      facts: bundle.canon.facts.length,
      beliefs: bundle.canon.beliefs.length,
      statements: bundle.canon.statements.length,
      proofs: bundle.canon.proofs.length,
      gates: bundle.gates.length,
      reports: bundle.reports.length,
      hints: bundle.hints.length,
      events: bundle.events.length,
      assets: bundle.assets.length,
    },
    reachability: checks.reachability,
    warnings: [...new Set([...warnings, ...checks.warnings])].sort((a, b) => a.localeCompare(b)),
  };

  return { bundle: verified.data, bundleJson, report };
}

function assembleBundle(source: WorldSourceFiles, artifacts: ReturnType<typeof artifactize>["artifacts"], assetRecords: Asset[], salt: string): WorldBundleT {
  const bundleGates: BundleGate[] = source.gates.map((gate) => {
    let check: BundleGateCheck;
    if (gate.check.kind === "answer") {
      const steps = gate.check.normalize;
      check = {
        kind: "answer",
        normalize: steps,
        answerHashes: gate.check.answers.map((answer) => hashAnswer(salt, gate.id, normalizeAnswer(answer, steps))),
      };
    } else {
      check = gate.check;
    }
    return {
      id: gate.id,
      title: gate.title,
      ...(gate.requires !== undefined ? { requires: gate.requires } : {}),
      check,
      unlocks: gate.unlocks,
      score: gate.score,
    };
  });

  const bundleReports: BundleReport[] = source.reports.map((report) => ({
    id: report.id,
    title: report.title,
    groups: report.groups.map((group) => ({
      id: group.id,
      slots: group.slots.map((slot): BundleReportSlot => {
        const steps = SlotNormalizers[slot.type];
        return {
          id: slot.id,
          label: slot.label,
          type: slot.type,
          ...(slot.options !== undefined ? { options: slot.options } : {}),
          fact: slot.fact,
          answerHashes: slot.answers.map((answer) => hashAnswer(salt, slot.id, normalizeAnswer(answer, steps))),
        };
      }),
    })),
  }));

  const bundle: Record<string, unknown> = {
    world: source.world,
    entities: [...source.people, ...source.orgs],
    identities: source.identities,
    artifacts,
    gates: bundleGates,
    reports: bundleReports,
    hints: source.hints,
    events: source.events,
    canon: {
      facts: source.facts,
      beliefs: source.beliefs,
      statements: source.statements,
      proofs: source.proofs,
    },
    assets: assetRecords,
    forge: source.forge.map((f) => f.repo),
    mailboxes: source.mail.map((m) => m.mailbox),
    bundleSalt: salt,
    bundleHash: "",
  };
  bundle.bundleHash = computeBundleHash(bundle);
  return bundle as WorldBundleT;
}
