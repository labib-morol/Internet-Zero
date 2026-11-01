/* eslint-disable no-undef -- build scripts run in Node; the root flat config does not set node globals for .mjs */
// Copies the vendored TLD list from src/ to dist/ after tsc; part of `pnpm build`.
// To re-fetch the list from IANA instead, run scripts/refresh-tlds.mjs.
import { copyFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
try {
  await access(`${here}../dist`);
  await copyFile(`${here}../src/tlds.txt`, `${here}../dist/tlds.txt`);
  console.log("tlds.txt synced to dist/");
} catch {
  console.error("dist/ missing or src/tlds.txt missing");
  process.exit(1);
}
