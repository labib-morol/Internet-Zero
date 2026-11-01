import { z } from "zod";

export const Normalizer = z.enum(["nfkc", "lower", "trim", "collapse", "stripPunct"]);
export type Normalizer = z.infer<typeof Normalizer>;

/**
 * Shared answer normalization. The compiler hashes with this and the runtime
 * hashes submissions with it — a single implementation so the two can never
 * drift. Pure string operations only.
 */
export function normalizeAnswer(input: string, steps: readonly Normalizer[]): string {
  let s = input;
  for (const step of steps) {
    switch (step) {
      case "nfkc":
        s = s.normalize("NFKC");
        break;
      case "lower":
        s = s.toLowerCase();
        break;
      case "trim":
        s = s.trim();
        break;
      case "collapse":
        s = s.replace(/\s+/g, " ");
        break;
      case "stripPunct":
        s = s.replace(/[^\p{L}\p{N}\s]/gu, "");
        break;
    }
  }
  return s;
}
