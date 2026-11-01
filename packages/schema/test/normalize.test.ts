import { describe, expect, it } from "vitest";
import { normalizeAnswer } from "../src/normalize.js";

describe("normalizeAnswer", () => {
  it("applies the tutorial default chain (nfkc, lower, trim, collapse)", () => {
    expect(normalizeAnswer("  Biscuit  2009 ", ["nfkc", "lower", "trim", "collapse"])).toBe("biscuit 2009");
  });

  it("fullwidth characters fold via nfkc", () => {
    expect(normalizeAnswer("ＢＩＳＣＵＩＴ", ["nfkc", "lower"])).toBe("biscuit");
  });

  it("stripPunct keeps letters, digits and spaces only", () => {
    expect(normalizeAnswer("Biscuit-2009!", ["lower", "stripPunct"])).toBe("biscuit2009");
    expect(normalizeAnswer("ash-wt-0417", ["lower", "stripPunct"])).toBe("ashwt0417");
  });

  it("is idempotent over random-ish inputs", () => {
    const steps = ["nfkc", "lower", "trim", "collapse", "stripPunct"] as const;
    for (const input of ["  MiXeD Ｃase  42!! ", "biscuit2009", "\tA  B\tC "]) {
      const once = normalizeAnswer(input, steps);
      expect(normalizeAnswer(once, steps)).toBe(once);
    }
  });
});
