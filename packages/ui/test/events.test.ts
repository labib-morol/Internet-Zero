import { describe, expect, it } from "vitest";
import type { GameEvent } from "@iz/schema";
import { applyEventsToWire, MAX_TRACKED_ATTEMPTS } from "../src/state/events.js";
import { hydrateState, normalizeWire, type WireRuntimeState } from "../src/state/wire.js";

function baseState(): WireRuntimeState {
  return {
    teamId: "team-1",
    worldId: "w.tutorial",
    bundleHash: "abc123",
    startedAt: "2026-11-02T10:00:00.000Z",
    solvedGates: {},
    unlocked: [],
    evidence: {},
    claims: {},
    links: {},
    hintsUsed: {},
    reportGroupsAccepted: {},
    firedEvents: [],
    overlayFs: {},
    readPaths: {},
    attempts: {},
    score: 0,
  };
}

const T = "2026-11-02T10:05:00.000Z";

describe("applyEventsToWire", () => {
  it("adds a solved gate and its score exactly once, even when the event is delivered twice", () => {
    const event: GameEvent = { type: "GateSolved", gateId: "g.first-commit", score: 25, at: T, by: "u.1", actorKind: "human" };
    const once = applyEventsToWire(baseState(), [event]);
    expect(once.solvedGates["g.first-commit"]).toEqual({ at: T, by: "u.1" });
    expect(once.score).toBe(25);
    const twice = applyEventsToWire(once, [event]);
    expect(twice.score).toBe(25);
  });

  it("keeps unlocked untouched from GateSolved (bundle not client-side) but normalizes arrays", () => {
    const event: GameEvent = { type: "GateSolved", gateId: "g.mailbox", score: 10, at: T, by: "u.1", actorKind: "human" };
    const next = applyEventsToWire({ ...baseState(), unlocked: ["z.host", "a.host"] }, [event]);
    expect(next.unlocked).toEqual(["a.host", "z.host"]); // sorted, unchanged otherwise
  });

  it("adds evidence from EvidenceCollected, using provenance hints when provided", () => {
    const event: GameEvent = {
      type: "EvidenceCollected",
      evidenceId: "ev.1",
      artifactId: "a.readme",
      at: T,
      by: "u.1",
      actorKind: "human",
    };
    const withHint = applyEventsToWire(baseState(), [event], {
      provenance: { "ev.1": { host: "forge.pinecone.pcp", path: "/x", service: "forge" } },
    });
    expect(withHint.evidence["ev.1"]?.provenance).toEqual({ host: "forge.pinecone.pcp", path: "/x", service: "forge" });
    const withoutHint = applyEventsToWire(baseState(), [event]);
    expect(withoutHint.evidence["ev.1"]?.archived).toBe(false);
  });

  it("archives evidence", () => {
    const collect: GameEvent = { type: "EvidenceCollected", evidenceId: "ev.1", artifactId: "a.doc", at: T, by: "u.1", actorKind: "human" };
    const archive: GameEvent = { type: "EvidenceArchived", evidenceId: "ev.1", at: T, by: "u.1", actorKind: "human" };
    const next = applyEventsToWire(applyEventsToWire(baseState(), [collect]), [archive]);
    expect(next.evidence["ev.1"]?.archived).toBe(true);
  });

  it("applies hint costs once per tier and never for duplicate delivery", () => {
    const tier1: GameEvent = { type: "HintRequested", gateId: "g.x", tier: 1, cost: 5, at: T, by: "u.1", actorKind: "human" };
    const tier2: GameEvent = { type: "HintRequested", gateId: "g.x", tier: 2, cost: 10, at: T, by: "u.1", actorKind: "human" };
    const s1 = applyEventsToWire(baseState(), [tier1]);
    expect(s1.hintsUsed["g.x"]).toBe(1);
    expect(s1.score).toBe(-5);
    const s1dup = applyEventsToWire(s1, [tier1]);
    expect(s1dup.score).toBe(-5); // duplicate: no second deduction
    const s2 = applyEventsToWire(s1dup, [tier2]);
    expect(s2.hintsUsed["g.x"]).toBe(2);
    expect(s2.score).toBe(-15);
    const s2dup = applyEventsToWire(s2, [tier2, tier1]);
    expect(s2dup.score).toBe(-15);
  });

  it("records attempts with the newest-50 cap", () => {
    const attempts: GameEvent[] = Array.from({ length: MAX_TRACKED_ATTEMPTS + 5 }, (_, i) => ({
      type: "AnswerRejected" as const,
      gateId: "g.x",
      at: `2026-11-02T10:00:${String(i % 60).padStart(2, "0")}.000Z`,
      by: "u.1",
      actorKind: "human" as const,
    }));
    const next = applyEventsToWire(baseState(), attempts);
    const recorded = next.attempts["g.x"] ?? [];
    expect(recorded).toHaveLength(MAX_TRACKED_ATTEMPTS);
    expect(recorded[recorded.length - 1]?.at).toBe(attempts[attempts.length - 1]?.at);
  });

  it("accepts report groups idempotently and tracks terminal reads per host", () => {
    const accept: GameEvent = { type: "ReportGroupAccepted", reportId: "r.final", groupId: "grp.a", at: T, by: "u.1", actorKind: "human" };
    const read: GameEvent = { type: "TerminalRead", host: "printer.pinecone.pcp", path: "/logs/shift.log", at: T, by: "u.1", actorKind: "human" };
    const next = applyEventsToWire(baseState(), [accept, accept, read]);
    expect(next.reportGroupsAccepted["r.final"]).toEqual(["grp.a"]);
    expect(next.readPaths["printer.pinecone.pcp"]).toEqual(["/logs/shift.log"]);
  });

  it("adds and removes links, edits claims, marks fired world events", () => {
    const state = baseState();
    const claim: GameEvent = { type: "ClaimCreated", claimId: "c.1", text: "x", private: false, at: T, by: "u.1", actorKind: "human" };
    const edit: GameEvent = { type: "ClaimEdited", claimId: "c.1", text: "y", at: T, by: "u.1", actorKind: "human" };
    const link: GameEvent = { type: "LinkCreated", linkId: "l.1", from: "c.1", to: "ev.1", relation: "supports", confidence: 2, at: T, by: "u.1", actorKind: "human" };
    const fired: GameEvent = { type: "WorldEventFired", eventId: "e.lanternfish", at: T, by: "system", actorKind: "agent" };
    let next = applyEventsToWire(state, [claim, edit, link, fired]);
    expect(next.claims["c.1"]?.text).toBe("y");
    expect(next.links["l.1"]?.relation).toBe("supports");
    expect(next.firedEvents).toEqual(["e.lanternfish"]);
    next = applyEventsToWire(next, [{ type: "LinkRemoved", linkId: "l.1", at: T, by: "u.1", actorKind: "human" }]);
    expect(next.links["l.1"]).toBeUndefined();
    expect(next.firedEvents).toEqual(["e.lanternfish"]); // idempotent
  });

  it("fills identity fields from SessionStarted when the state is empty", () => {
    const empty = { ...baseState(), teamId: "", worldId: "", bundleHash: "", startedAt: "" };
    const event: GameEvent = {
      type: "SessionStarted",
      teamId: "t.9",
      worldId: "w.tutorial",
      bundleHash: "hash",
      startedAt: T,
      at: T,
      by: "u.1",
      actorKind: "human",
    };
    const next = applyEventsToWire(empty, [event]);
    expect(next.teamId).toBe("t.9");
    expect(next.startedAt).toBe(T);
  });

  it("round-trips through hydrateState (arrays to Sets)", () => {
    const state = applyEventsToWire(baseState(), [
      { type: "GateSolved", gateId: "g.x", score: 5, at: T, by: "u.1", actorKind: "human" },
      { type: "TerminalRead", host: "h", path: "/p", at: T, by: "u.1", actorKind: "human" },
    ]);
    const hydrated = hydrateState(state);
    expect(hydrated.unlocked).toBeInstanceOf(Set);
    expect(hydrated.firedEvents).toBeInstanceOf(Set);
    expect(hydrated.readPaths["h"]).toBeInstanceOf(Set);
    expect(hydrated.readPaths["h"]?.has("/p")).toBe(true);
  });

  it("normalizeWire sorts and deduplicates the set-shaped arrays", () => {
    const next = normalizeWire({ ...baseState(), unlocked: ["b", "a", "b"], firedEvents: ["e.2", "e.1"] });
    expect(next.unlocked).toEqual(["a", "b"]);
    expect(next.firedEvents).toEqual(["e.1", "e.2"]);
  });
});
