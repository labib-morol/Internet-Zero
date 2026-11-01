import { createHash } from "node:crypto";

/**
 * Canonical answer-hash format (master prompt §6.4):
 * sha256(bundleSalt + ":" + gateOrSlotId + ":" + normalized) as lowercase hex.
 * The compiler hashes with this and the runtime hashes submissions with it.
 */
export function hashAnswer(salt: string, id: string, normalized: string): string {
  return createHash("sha256").update(`${salt}:${id}:${normalized}`).digest("hex");
}
