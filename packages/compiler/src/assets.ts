import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Asset } from "@iz/schema";
import { IssueCollector } from "./source.js";

/**
 * Content-addressed assets (build item 7): files under the world `assets/`
 * folder and under each service's `assets/` folder are hashed; the asset id is
 * the file's sha256 hex. The index is keyed by BOTH the world-relative path and
 * the sha256 id so author-written references resolve while the bundle only ever
 * stores content-addressed ids. Worlds may legitimately have zero assets.
 */

const MAX_ASSET_BYTES = 10 * 1024 * 1024; // build check 10

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  xml: "application/xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  zip: "application/zip",
};

export function contentTypeFor(name: string): string {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

export type AssetIndex = {
  /** Unique asset records for the bundle. */
  records: Asset[];
  /** Path keys and id keys pointing at the same records. */
  byKey: Map<string, Asset>;
};

export async function scanAssets(dir: string, collector: IssueCollector): Promise<AssetIndex> {
  const folders: Array<{ root: string; base: string }> = [{ root: join(dir, "assets"), base: "assets" }];
  const servicesDir = join(dir, "services");
  let serviceNames: string[] = [];
  try {
    serviceNames = (await readdir(servicesDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // no services dir at all
  }
  for (const service of serviceNames) {
    folders.push({ root: join(servicesDir, service, "assets"), base: `services/${service}/assets` });
  }

  const records: Asset[] = [];
  const byKey = new Map<string, Asset>();
  const seenIds = new Set<string>();

  for (const folder of folders) {
    const files = await walk(folder.root);
    for (const relative of files) {
      const absolute = join(folder.root, relative);
      const key = `${folder.base}/${relative.split("\\").join("/")}`;
      const info = await stat(absolute);
      if (info.size === 0) {
        collector.add({ check: 10, file: key, message: "asset file is empty (0 bytes)" });
        continue;
      }
      if (info.size > MAX_ASSET_BYTES) {
        collector.add({ check: 10, file: key, message: `asset is ${info.size} bytes; the limit is ${MAX_ASSET_BYTES}` });
        continue;
      }
      const bytes = await readFile(absolute);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const asset: Asset = { id: sha256, sha256, bytes: info.size, contentType: contentTypeFor(key) };
      byKey.set(key, asset);
      byKey.set(sha256, asset);
      if (!seenIds.has(sha256)) {
        seenIds.add(sha256);
        records.push(asset);
      }
    }
  }

  records.sort((a, b) => a.id.localeCompare(b.id));
  return { records, byKey };
}

async function walk(root: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(join(root, entry.name), relative)));
    else if (entry.isFile()) out.push(relative);
  }
  return out;
}
