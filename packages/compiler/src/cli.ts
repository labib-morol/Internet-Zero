#!/usr/bin/env node
/**
 * iz — INTRANET ZERO world compiler.
 *
 * Usage: node dist/cli.js build <worldSourceDir> [--out <dir>] [--salt <hex>] [--report <path>]
 *   Compiles one world source dir (world.yaml, people.yaml, ..., services/) into
 *   <out>/<worldId>@<version>.json (a WorldBundle) plus a report.json (counts,
 *   reachability tree, warnings). Defaults: --out dist/worlds, --report <out>/report.json,
 *   salt = random 32 hex chars (pass --salt for reproducible builds).
 *   Exits 1 with every failing build check (number + file + id) on failure.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { compileWorld } from "./pipeline.js";
import { BuildError } from "./errors.js";
import { scanAssets } from './assets.js';
import { emitAssets } from './emit-assets.js';
import { IssueCollector } from './source.js';

interface Args {
  dir: string;
  out: string;
  salt: string | undefined;
  report: string | undefined;
}

function usage(): never {
  console.error("usage: iz build <worldSourceDir> [--out <dir>] [--salt <hex>] [--report <path>]");
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  if (argv.length < 1 || argv[0] !== "build") usage();
  const positional = argv[1];
  if (positional === undefined) usage();
  let out = "dist/worlds";
  let salt: string | undefined;
  let report: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--out") out = requireValue(argv, (i += 1));
    else if (flag === "--salt") salt = requireValue(argv, (i += 1));
    else if (flag === "--report") report = requireValue(argv, (i += 1));
    else usage();
  }
  return { dir: positional, out, salt, report };
}

function requireValue(argv: string[], index: number): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) usage();
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    const { bundle, bundleJson, report } = await compileWorld(args.dir, { salt: args.salt });
    const outDir = resolve(args.out);
    const bundlePath = `${outDir}/${bundle.world.id}@${bundle.world.version}.json`;
    const reportPath = resolve(args.report ?? `${outDir}/report.json`);

    await mkdir(dirname(bundlePath), { recursive: true });
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(bundlePath, bundleJson, "utf8");
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    const assets = await scanAssets(resolve(args.dir), new IssueCollector());
    await emitAssets(resolve(args.dir), `${outDir}/assets`, assets);

    console.log(`compiled ${bundle.world.id}@${bundle.world.version}`);
    console.log(`  bundle: ${bundlePath}`);
    console.log(`  report: ${reportPath}`);
    console.log(`  bundleHash: ${bundle.bundleHash}`);
    console.log(`  artifacts: ${report.counts.artifacts}, gates: ${report.counts.gates}, assets: ${report.counts.assets}`);
    if (report.warnings.length > 0) {
      console.log(`  warnings (${report.warnings.length}):`);
      for (const warning of report.warnings) console.log(`    - ${warning}`);
    }
  } catch (error) {
    if (error instanceof BuildError) {
      console.error(`build failed with ${error.issues.length} issue(s):`);
      for (const issue of error.issues) {
        console.error(`  check ${issue.check} | ${issue.file}${issue.id ? ` | ${issue.id}` : ""} | ${issue.message}`);
      }
      process.exit(1);
    }
    throw error;
  }
}

await main();
