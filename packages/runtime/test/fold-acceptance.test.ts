import { describe, expect, it } from "vitest";
import type { GameEvent } from "@iz/schema";
import { fold } from "../src/fold.js";
import { fixtureBundle, TEAM_ID, START } from "./fixtures/bundle.js";

/**
 * Audit outcome (ruling): the doc claimed only rejections count as attempts,
 * but the pinned integrity behavior counts accepted submissions too — the
 * conservative anti-brute-force budget. This test pins the ACCEPTED-side
 * recording so the doc and the code can never drift apart silently again.
 */
describe("fold: accepted report groups", () => {
  it("counts accepted groups as attempts (conservative budget) without duplicates", () => {
    const state = fold(fixtureBundle, [
      { type: "SessionStarted", teamId: TEAM_ID, worldId: fixtureBundle.world.id, bundleHash: fixtureBundle.bundleHash, startedAt: START, at: START, by: "user.x", actorKind: "human" },
      { type: "ReportGroupAccepted", reportId: "r.case", groupId: "A", at: START, by: "user.x", actorKind: "human" },
      { type: "ReportGroupAccepted", reportId: "r.case", groupId: "B", at: START, by: "user.x", actorKind: "human" },
      { type: "ReportGroupAccepted", reportId: "r.case", groupId: "A", at: START, by: "user.x", actorKind: "human" }, // duplicate delivery
    ] as GameEvent[]);
    expect(state.reportGroupsAccepted["r.case"]).toEqual(["A", "B"]);
    expect(state.attempts["r.case"]).toHaveLength(2);
  });
});
