import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WorldBundle, type GameEvent } from "@iz/schema";
import { scoreRun } from "@iz/agent-runner";

const bundle = WorldBundle.parse(
  JSON.parse(readFileSync(resolve("packages/services/test/fixtures/fixture@0.1.0.json"), "utf8"))
);

const base = (type: string, extra: Record<string, unknown>): GameEvent =>
  ({ type, at: "2026-11-02T09:05:00.000Z", by: "u1", actorKind: "agent", ...extra }) as GameEvent;

const session = base("SessionStarted", { teamId: "t", worldId: "fixture", bundleHash: bundle.bundleHash, startedAt: "2026-11-02T09:00:00.000Z" });

describe("scorer (§14.3)", () => {
  it("reports a completed run when all gates and report groups land", () => {
    const events: GameEvent[] = [
      session,
      base("GateSolved", { gateId: "g.first-commit", score: 100 }),
      base("EvidenceCollected", { evidenceId: "ev.1", artifactId: "a.commit-1" }),
      base("ClaimCreated", { claimId: "cl.1", text: "x", private: false }),
      base("LinkCreated", { linkId: "ln.1", from: "ev.1", to: "cl.1", relation: "supports", confidence: 2 }),
      ...bundle.reports.flatMap((r) => r.groups.map((g) => base("ReportGroupAccepted", { reportId: r.id, groupId: g.id }))),
      ...bundle.gates.filter((g) => g.id !== "g.first-commit").map((g) => base("GateSolved", { gateId: g.id, score: g.score })),
    ];
    const report = scoreRun(bundle, events, "oracle");
    expect(report.completed).toBe(true);
    expect(report.gatesSolved).toBe(bundle.gates.length);
    expect(report.reportSlotsCorrect).toBe(report.reportSlotsTotal);
    expect(report.unsupportedClaims).toBe(0);
    expect(report.requiredFactsEvidenced).toBeLessThanOrEqual(report.requiredFactsTotal);
    expect(report.world).toBe("fixture@0.1.0");
    expect(report.wallSeconds).toBe(300);
    expect(report.tokens).toEqual({ input: null, output: null });
  });

  it("marks unsupported claims and incomplete runs", () => {
    const events: GameEvent[] = [
      session,
      base("ClaimCreated", { claimId: "cl.2", text: "unsupported", private: false }),
    ];
    const report = scoreRun(bundle, events, "probe");
    expect(report.completed).toBe(false);
    expect(report.unsupportedClaims).toBe(1);
    expect(report.gatesSolved).toBe(0);
  });
});
