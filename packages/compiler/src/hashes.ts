import { createHash } from "node:crypto";

/**
 * Canonical JSON: object keys recursively sorted, no whitespace. The bundleHash
 * and reproducible builds are defined over this form (section 6.4).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * bundleHash = sha256 of the canonical JSON of the bundle with the bundleHash
 * field itself omitted.
 */
export function computeBundleHash(bundle: Record<string, unknown>): string {
  const { bundleHash: _omitted, ...rest } = bundle;
  return sha256Hex(canonicalJson(rest));
}
