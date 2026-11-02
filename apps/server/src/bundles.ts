import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { WorldBundle, type WorldBundle as WorldBundleType } from "@iz/schema";
import { verifyBundle } from './verify-bundle.js';

/**
 * Bundle registry (§6.4): every *.json in WORLDS_DIR must be a valid
 * WorldBundle; an invalid or duplicate world fails the boot. The registry is
 * immutable for the life of the process.
 */
export interface BundleRegistry {
  readonly size: number;
  get(worldId: string): WorldBundleType | undefined;
  list(): WorldBundleType[];
}

export async function loadBundles(worldsDir: string): Promise<BundleRegistry> {
  let fileNames: string[];
  try {
    fileNames = await readdir(worldsDir);
  } catch (error) {
    throw new Error(`WORLDS_DIR is not readable: ${worldsDir} (${String(error)})`, { cause: error });
  }

  const byId = new Map<string, WorldBundleType>();
  for (const fileName of fileNames.sort()) {
    if (!fileName.endsWith(".json")) continue;
    const path = join(worldsDir, fileName);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      throw new Error(`Cannot read bundle ${fileName}: ${String(error)}`, { cause: error });
    }
    if (Buffer.byteLength(raw) > 50 * 1024 * 1024) throw new Error('Oversize world bundle');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Bundle ${fileName} is not valid JSON: ${String(error)}`, { cause: error });
    }
    const result = WorldBundle.safeParse(parsed);
    if (!result.success) {
      const detail = result.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new Error(`Invalid world bundle ${fileName}: ${detail}`);
    }
    const bundle = result.data;
    verifyBundle(bundle, parsed);
    const existing = byId.get(bundle.world.id);
    if (existing !== undefined) {
      throw new Error(
        `Duplicate world id "${bundle.world.id}" in bundles ${fileName} and ${existing.world.id}@${existing.world.version}`
      );
    }
    byId.set(bundle.world.id, bundle);
  }

  if (byId.size === 0) {
    throw new Error(`No world bundles found in WORLDS_DIR (${worldsDir})`);
  }
  return {
    size: byId.size,
    get: (worldId: string) => byId.get(worldId),
    list: () => [...byId.values()],
  };
}
