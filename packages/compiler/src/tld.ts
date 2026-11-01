import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Vendored IANA TLD list (build check 12): the file is fetched once by
 * scripts/refresh-tlds.mjs and committed at src/tlds.txt; the build copies it
 * next to the compiled output. Case-insensitive lookups.
 */
let cache: Set<string> | undefined;

function candidateUrls(): URL[] {
  const here = new URL(import.meta.url);
  return [
    // Sits next to the module in both layouts (src/tlds.txt and dist/tlds.txt).
    new URL("./tlds.txt", here),
    // Fallback when running from dist without the copy step.
    new URL("../../src/tlds.txt", here),
  ];
}

export function loadTlds(): Set<string> {
  if (cache) return cache;
  const errors: string[] = [];
  for (const url of candidateUrls()) {
    try {
      const text = readFileSync(fileURLToPath(url), "utf8");
      cache = parseTldList(text);
      return cache;
    } catch (error) {
      errors.push(`${url.pathname}: ${(error as Error).message}`);
    }
  }
  throw new Error(`vendored TLD list not found; run scripts/refresh-tlds.mjs. Tried:\n${errors.join("\n")}`);
}

/** Parses the IANA tlds-alpha-by-domain.txt format (comment lines, one TLD per line). */
export function parseTldList(text: string): Set<string> {
  const set = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const tld = line.trim();
    if (tld.length === 0 || tld.startsWith("#")) continue;
    set.add(tld.toLowerCase());
  }
  return set;
}

/** True when the label is a real, currently-delegated top-level domain. */
export function isRealTld(label: string): boolean {
  return loadTlds().has(label.trim().toLowerCase());
}
