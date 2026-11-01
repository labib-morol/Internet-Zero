import { describe, expect, it } from "vitest";
import { Gate, BundleGate, Report, Hint } from "../src/gates.js";

describe("Gate (source)", () => {
  it("defaults normalize chain, unlocks and score", () => {
    const gate = Gate.parse({
      id: "g.printer",
      title: "Printer passphrase",
      check: { kind: "answer", answers: ["biscuit2009"] },
    });
    expect(gate.check).toMatchObject({ normalize: ["nfkc", "lower", "trim", "collapse"] });
    expect(gate.unlocks).toEqual([]);
    expect(gate.score).toBe(100);
  });

  it("parses an evidenceSet gate with mustLink default", () => {
    const gate = Gate.parse({
      id: "g.first-commit",
      title: "Find the rotation commit",
      check: { kind: "evidenceSet", mustCollect: ["a.commit-0002"] },
    });
    expect(gate.check).toMatchObject({ kind: "evidenceSet", mustLink: [] });
  });

  it("parses terminal and report checks", () => {
    expect(
      Gate.safeParse({ id: "g.read", title: "t", check: { kind: "terminal", mustHaveRead: ["/etc/motd"], host: "printer.pinecone.pcp" } }).success
    ).toBe(true);
    expect(
      Gate.safeParse({ id: "g.mailbox", title: "t", check: { kind: "report", report: "r.who-holds" } }).success
    ).toBe(true);
  });

  it("rejects unknown check kinds and plaintext answers in bundle gates", () => {
    expect(Gate.safeParse({ id: "g.x", title: "t", check: { kind: "quiz" } }).success).toBe(false);
    expect(
      BundleGate.safeParse({ id: "g.x", title: "t", check: { kind: "answer", normalize: ["lower"], answers: ["biscuit2009"] } })
        .success
    ).toBe(false);
    expect(
      BundleGate.safeParse({ id: "g.x", title: "t", check: { kind: "answer", normalize: ["lower"], answerHashes: ["zz"] } })
        .success
    ).toBe(false);
  });
});

describe("Report", () => {
  it("requires at least one group with one slot", () => {
    const report = Report.parse({
      id: "r.who-holds",
      title: "Who holds the hint?",
      groups: [
        {
          id: "A",
          slots: [
            { id: "s1", label: "Who holds the hint?", type: "identity", fact: "f.holder", answers: ["id.odile", "Odile Brandt"] },
            { id: "s2", label: "What kind of clue?", type: "choice", options: ["a", "b"], fact: "f.clue-kind", answers: ["a"] },
          ],
        },
      ],
    });
    expect(report.groups).toHaveLength(1);
    expect(Report.safeParse({ id: "r.x", title: "t", groups: [] }).success).toBe(false);
  });
});

describe("Hint", () => {
  it("accepts tiers 1..3 only", () => {
    expect(Hint.safeParse({ gate: "g.x", tier: 1, text: "nudge", cost: 10 }).success).toBe(true);
    expect(Hint.safeParse({ gate: "g.x", tier: 4, text: "nudge", cost: 10 }).success).toBe(false);
  });
});
