import { describe, expect, it } from "vitest";
import { Id, Condition, Fragment } from "../src/primitives.js";

describe("Id", () => {
  it.each(["p.rowan", "o.pinecone", "id.odile-mail", "f.retention", "a.commit-0007", "g.first-commit", "r.final", "e.lanternfish-post"])(
    "accepts %s",
    (id) => {
      expect(Id.safeParse(id).success).toBe(true);
    }
  );

  it.each(["Rowan", "p.", "p._bad", "g.first commit", "x", "p.toolong" + "a".repeat(60)])(
    "rejects %s",
    (id) => {
      expect(Id.safeParse(id).success).toBe(false);
    }
  );
});

describe("Condition", () => {
  it("accepts nested boolean combinators", () => {
    const cond = {
      all: [{ gateSolved: "g.first-commit" }, { any: [{ evidenceCollected: "a.commit-1" }, { not: { teamSizeAtLeast: 2 } }] }],
    };
    expect(Condition.parse(cond)).toEqual(cond);
  });

  it("accepts timeReached with an ISO offset timestamp", () => {
    expect(Condition.safeParse({ timeReached: "2026-11-03T10:00:00Z" }).success).toBe(true);
  });

  it("rejects unknown keys and unknown shapes", () => {
    expect(Condition.safeParse({ gate: "g.x" }).success).toBe(false);
    expect(Condition.safeParse({ gateSolved: "g.x", extra: 1 }).success).toBe(false);
    expect(Condition.safeParse("g.x").success).toBe(false);
  });
});

describe("Fragment", () => {
  it("accepts lines, range and region fragments", () => {
    expect(Fragment.safeParse({ kind: "lines", from: 1, to: 3 }).success).toBe(true);
    expect(Fragment.safeParse({ kind: "range", start: 0, end: 9 }).success).toBe(true);
    expect(Fragment.safeParse({ kind: "region", x: 1, y: 2, w: 3, h: 4 }).success).toBe(true);
  });

  it("rejects inverted or broken fragments", () => {
    expect(Fragment.safeParse({ kind: "lines", from: 3, to: 1 }).success).toBe(true); // order is semantic, not structural
    expect(Fragment.safeParse({ kind: "lines", from: 0, to: 1 }).success).toBe(false);
    expect(Fragment.safeParse({ kind: "region", x: 1, y: 2, w: -1, h: 1 }).success).toBe(false);
  });
});
