#!/usr/bin/env node
/* eslint-disable no-undef -- build scripts run in Node; the root flat config does not set node globals for .mjs */
// Re-fetches the IANA TLD list used by build check 12 and refreshes
// packages/compiler/src/tlds.txt (plus the dist copy when one exists).
// Usage: node scripts/refresh-tlds.mjs
import { writeFile, copyFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://data.iana.org/TLD/tlds-alpha-by-domain.txt";
const here = fileURLToPath(new URL(".", import.meta.url));
const srcTarget = `${here}../src/tlds.txt`;

const response = await fetch(SOURCE_URL);
if (!response.ok) {
  console.error(`fetch failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}
const text = await response.text();
if (!text.startsWith("# Version") || text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).length < 100) {
  console.error("fetched file does not look like the IANA TLD list; refusing to overwrite");
  process.exit(1);
}
await writeFile(srcTarget, text, "utf8");
console.log(`wrote ${srcTarget} (${text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).length} TLDs)`);

try {
  await access(`${here}../dist`);
  await copyFile(srcTarget, `${here}../dist/tlds.txt`);
  console.log("copied to dist/tlds.txt");
} catch {
  // dist not built yet; the build step copies it
}
