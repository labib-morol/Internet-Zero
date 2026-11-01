import { describe, expect, it } from "vitest";
import type { GameEvent, RuntimeState } from "@iz/schema";
import {
  apply,
  evaluateCondition,
  fold,
  initialState,
  isWorldComplete,
  replayEvents,
  visibleArtifacts,
} from "../src/index.js";
import { TestClock, ACTOR, START, TEAM_ID, applyAt, fixtureBundle, freshState, startLog } from "./helpers.js";
import { EPOCH } from "./fixtures/bundle.js";

const MIN = 60_000;

/** apply + fold one action onto a log, returning the new folded state. */
function step(state: RuntimeState, log: GameEvent[], action: Parameters<typeof apply>[2], clock: TestClock) {
  const result = apply(fixtureBundle, state, action, ACTOR, clock, log.length);
  log.push(...result.events);
  return { state: fold(fixtureBundle, log), result };
}

describe("initialState", () => {
  it("builds an empty team state with identity from the bundle", () => {
    const state = freshState();
    expect(state).toEqual({
      teamId: TEAM_ID,
      worldId: "tut",
      bundleHash: fixtureBundle.bundleHash,
      startedAt: START,
      solvedGates: {},
      unlocked: new Set(),
      evidence: {},
      claims: {},
      links: {},
      hintsUsed: {},
      reportGroupsAccepted: {},
      firedEvents: new Set(),
      overlayFs: {},
      readPaths: {},
      attempts: {},
      score: 0,
    });
  });

  it("derives identity fields in fold from the SessionStarted event", () => {
    const state = fold(fixtureBundle, startLog());
    expect(state.teamId).toBe(TEAM_ID);
    expect(state.startedAt).toBe(START);
    expect(state.worldId).toBe("tut");
  });

  it("throws when the log does not start with SessionStarted or matches another bundle", () => {
    expect(() => fold(fixtureBundle, [])).toThrow(/SessionStarted/);
    const bad: GameEvent[] = [
      { type: "ArtifactViewed", artifactId: "a.welcome-doc", at: START, by: "u", actorKind: "human" },
    ];
    expect(() => fold(fixtureBundle, bad)).toThrow(/SessionStarted/);
    const other = startLog().map((e) => (e.type === "SessionStarted" ? { ...e, bundleHash: "0".repeat(64) } : e));
    expect(() => fold(fixtureBundle, other)).toThrow(/different world or bundle/);
  });
});

describe("open and visibility", () => {
  it("emits ArtifactViewed for a visible page and returns no result", () => {
    const res = applyAt(freshState(), { type: "open", url: "archive.tut.iz/docs/welcome" }, new TestClock(START));
    expect(res.rejection).toBeUndefined();
    expect(res.result).toBeUndefined();
    expect(res.events).toEqual([
      { type: "ArtifactViewed", artifactId: "a.welcome-doc", at: START, by: ACTOR.userId, actorKind: "human" },
    ]);
  });

  it("does not reveal whether an unknown host differs from a locked one (both not_found)", () => {
    const clock = new TestClock(START);
    const unknown = applyAt(freshState(), { type: "open", url: "ghost.tut.iz/x" }, clock);
    const locked = applyAt(freshState(), { type: "open", url: "shell.tut.iz/home/player" }, clock);
    expect(unknown.rejection?.code).toBe("not_found");
    expect(locked.rejection?.code).toBe("not_found");
  });

  it("rejects locked with an existing but gated artifact (a.mail-welcome before the event)", () => {
    const res = applyAt(freshState(), { type: "open", url: "MAIL.tut.iz/inbox/hello" }, new TestClock(START));
    expect(res.rejection?.code).toBe("locked");
    expect(res.events).toEqual([]);
  });

  it("emits nothing for a reachable host with an unknown path", () => {
    const res = applyAt(freshState(), { type: "open", url: "archive.tut.iz/nope" }, new TestClock(START));
    expect(res.rejection).toBeUndefined();
    expect(res.events).toEqual([]);
  });

  it("makes a gate-unlocked artifact visible after the gate solves", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);
    ({ state } = step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: "lanternfish" }, clock));
    const open = applyAt(state, { type: "open", url: "archive.tut.iz/docs/hidden" }, clock, log.length);
    expect(open.rejection).toBeUndefined();
    expect(open.events.some((e) => e.type === "ArtifactViewed" && e.artifactId === "a.hidden-doc")).toBe(true);
  });

  it("marks a revealed host reachable and its artifacts visible (e.late revealHosts)", () => {
    const clock = new TestClock(START);
    clock.advance(31 * MIN); // world time = epoch + 31m >= 00:30
    const log = startLog();
    let state = fold(fixtureBundle, log);
    ({ state } = step(state, log, { type: "search", query: "warm up the clock" }, clock));
    expect(state.firedEvents.has("e.late")).toBe(true);
    expect(state.unlocked.has("vault.tut.iz")).toBe(true);
    const open = applyAt(state, { type: "open", url: "vault.tut.iz/note" }, clock, log.length);
    expect(open.rejection).toBeUndefined();
    expect(open.events.some((e) => e.type === "ArtifactViewed" && e.artifactId === "a.vault-note")).toBe(true);
  });

  it("lists exactly the t0-visible artifacts in visibleArtifacts", () => {
    const ids = visibleArtifacts(fixtureBundle, freshState(), START).map((a) => a.id);
    expect(ids).toEqual(["a.welcome-doc"]);
  });
});

describe("search", () => {
  it("returns the query (and host when given) with no events", () => {
    const clock = new TestClock(START);
    const res = applyAt(freshState(), { type: "search", query: "lanternfish" }, clock);
    expect(res.events).toEqual([]);
    expect(res.result).toEqual({ query: "lanternfish" });
    const res2 = applyAt(freshState(), { type: "search", query: "lanternfish", host: "archive.tut.iz" }, clock);
    expect(res2.result).toEqual({ query: "lanternfish", host: "archive.tut.iz" });
  });
});

describe("collect", () => {
  it("creates deterministic evidence and replays provenance through fold", () => {
    const clock = new TestClock(START);
    const res = applyAt(freshState(), { type: "collect", artifactId: "a.welcome-doc" }, clock);
    expect(res.rejection).toBeUndefined();
    const evidenceId = (res.result as { evidenceId: string }).evidenceId;
    expect(evidenceId).toMatch(/^ev\.[0-9a-f]{16}$/);
    const state = fold(fixtureBundle, [...startLog(), ...res.events]);
    expect(Object.values(state.evidence)).toEqual([
      {
        id: evidenceId,
        artifactId: "a.welcome-doc",
        collectedBy: ACTOR.userId,
        collectedAt: START,
        provenance: { host: "archive.tut.iz", path: "/docs/welcome", service: "archive" },
        archived: false,
      },
    ]);
  });

  it("is idempotent per artifact + fragment: same id, no new event", () => {
    const clock = new TestClock(START);
    const first = applyAt(freshState(), { type: "collect", artifactId: "a.welcome-doc" }, clock);
    const firstId = (first.result as { evidenceId: string }).evidenceId;
    const log = [...startLog(), ...first.events];
    const state = fold(fixtureBundle, log);
    const again = applyAt(state, { type: "collect", artifactId: "a.welcome-doc" }, clock, log.length);
    expect(again.events).toEqual([]);
    expect((again.result as { evidenceId: string }).evidenceId).toBe(firstId);
  });

  it("treats different fragments as different evidence, regardless of key order", () => {
    const clock = new TestClock(START);
    const a = applyAt(
      freshState(),
      { type: "collect", artifactId: "a.welcome-doc", fragment: { kind: "lines", from: 1, to: 3 } },
      clock
    );
    const b = applyAt(
      freshState(),
      { type: "collect", artifactId: "a.welcome-doc", fragment: { kind: "lines", to: 3, from: 1 } },
      clock
    );
    expect((a.result as { evidenceId: string }).evidenceId).toBe((b.result as { evidenceId: string }).evidenceId);
    const other = applyAt(
      freshState(),
      { type: "collect", artifactId: "a.welcome-doc", fragment: { kind: "lines", from: 2, to: 3 } },
      clock
    );
    expect((other.result as { evidenceId: string }).evidenceId).not.toBe((a.result as { evidenceId: string }).evidenceId);
  });

  it("rejects unknown artifacts and invisible artifacts", () => {
    const clock = new TestClock(START);
    expect(applyAt(freshState(), { type: "collect", artifactId: "a.nope" }, clock).rejection?.code).toBe("not_found");
    expect(applyAt(freshState(), { type: "collect", artifactId: "a.mail-welcome" }, clock).rejection?.code).toBe("locked");
  });
});

describe("claims and links", () => {
  it("creates a claim with a deterministic id and folds it back", () => {
    const clock = new TestClock(START);
    const res = applyAt(freshState(), { type: "claim", text: "Mira sent the mail.", private: false }, clock);
    const claimId = (res.result as { claimId: string }).claimId;
    expect(claimId).toMatch(/^cl\.[0-9a-f]{16}$/);
    const state = fold(fixtureBundle, [...startLog(), ...res.events]);
    expect(Object.values(state.claims)).toEqual([
      { id: claimId, text: "Mira sent the mail.", createdBy: ACTOR.userId, createdAt: START, private: false },
    ]);
  });

  it("defaults private to false when the action omits it", () => {
    const clock = new TestClock(START);
    const res = applyAt(freshState(), { type: "claim", text: "note", private: false }, clock);
    const state = fold(fixtureBundle, [...startLog(), ...res.events]);
    expect(Object.values(state.claims)[0]?.private).toBe(false);
  });

  it("edits claim text; unknown claims are not_found", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);
    const made = step(state, log, { type: "claim", text: "before", private: false }, clock);
    state = made.state;
    const claimId = (made.result.result as { claimId: string }).claimId;
    const edited = step(state, log, { type: "editClaim", claimId, text: "after" }, clock);
    expect(edited.result.rejection).toBeUndefined();
    expect(edited.state.claims[claimId]?.text).toBe("after");
    const missing = applyAt(state, { type: "editClaim", claimId: "cl.nope", text: "x" }, clock, log.length);
    expect(missing.rejection?.code).toBe("not_found");
  });

  it("links existing evidence and claims, unlinks, and rejects unknown endpoints", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);
    const col = step(state, log, { type: "collect", artifactId: "a.welcome-doc" }, clock);
    state = col.state;
    const evidenceId = (col.result.result as { evidenceId: string }).evidenceId;
    const clm = step(state, log, { type: "claim", text: "a thought", private: false }, clock);
    state = clm.state;
    const claimId = (clm.result.result as { claimId: string }).claimId;

    const linked = step(state, log, { type: "link", from: evidenceId, to: claimId, relation: "supports", confidence: 3 }, clock);
    expect(linked.result.rejection).toBeUndefined();
    const linkId = (linked.result.result as { linkId: string }).linkId;
    expect(linkId).toMatch(/^ln\.[0-9a-f]{16}$/);
    expect(Object.values(linked.state.links)).toEqual([
      {
        id: linkId,
        from: evidenceId,
        to: claimId,
        relation: "supports",
        confidence: 3,
        createdBy: ACTOR.userId,
        createdAt: START,
      },
    ]);

    const unlinked = step(linked.state, log, { type: "unlink", linkId }, clock);
    expect(unlinked.result.rejection).toBeUndefined();
    expect(unlinked.state.links[linkId]).toBeUndefined();

    const bad = applyAt(state, { type: "link", from: evidenceId, to: "cl.nope", relation: "supports", confidence: 1 }, clock, log.length);
    expect(bad.rejection?.code).toBe("not_found");
    const badUnlink = applyAt(state, { type: "unlink", linkId: "ln.nope" }, clock, log.length);
    expect(badUnlink.rejection?.code).toBe("not_found");
  });

  it("archives evidence; unknown evidence is not_found", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);
    const col = step(state, log, { type: "collect", artifactId: "a.welcome-doc" }, clock);
    state = col.state;
    const evidenceId = (col.result.result as { evidenceId: string }).evidenceId;
    const archived = step(state, log, { type: "archiveEvidence", evidenceId }, clock);
    expect(archived.state.evidence[evidenceId]?.archived).toBe(true);
    const missing = applyAt(state, { type: "archiveEvidence", evidenceId: "ev.nope" }, clock, log.length);
    expect(missing.rejection?.code).toBe("not_found");
  });
});

describe("answer gates", () => {
  it("solves on the correct answer (normalization applied), emits GateSolved, fold applies score and unlocks", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);
    const wrongCase = step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: "  LANTERNFISH  " }, clock);
    expect(wrongCase.result.rejection).toBeUndefined();
    expect(wrongCase.result.events).toEqual([
      { type: "GateSolved", gateId: "g.welcome", score: 100, at: START, by: ACTOR.userId, actorKind: "human" },
    ]);
    expect(wrongCase.state.solvedGates["g.welcome"]).toEqual({ at: START, by: ACTOR.userId });
    expect(wrongCase.state.score).toBe(100);
    expect(wrongCase.state.unlocked.has("a.hidden-doc")).toBe(true);
    state = wrongCase.state;

    const resubmit = applyAt(state, { type: "submitAnswer", gateId: "g.welcome", answer: "lanternfish" }, clock, log.length);
    expect(resubmit.rejection?.code).toBe("already_solved");
  });

  it("rejects wrong answers with an AnswerRejected event", () => {
    const res = applyAt(freshState(), { type: "submitAnswer", gateId: "g.welcome", answer: "jellyfish" }, new TestClock(START));
    expect(res.rejection?.code).toBe("invalid_input");
    expect(res.events).toEqual([
      { type: "AnswerRejected", gateId: "g.welcome", at: START, by: ACTOR.userId, actorKind: "human" },
    ]);
  });

  it("enforces the requires condition (locked) and existence (not_found)", () => {
    const clock = new TestClock(START);
    expect(
      applyAt(freshState(), { type: "submitAnswer", gateId: "g.gated", answer: "openseason" }, clock).rejection?.code
    ).toBe("locked");
    expect(
      applyAt(freshState(), { type: "submitAnswer", gateId: "g.nope", answer: "x" }, clock).rejection?.code
    ).toBe("not_found");
  });

  it("does not accept free-text answers for non-answer gates", () => {
    const res = applyAt(freshState(), { type: "submitAnswer", gateId: "g.evidence", answer: "x" }, new TestClock(START));
    expect(res.rejection?.code).toBe("invalid_input");
    expect(res.events).toEqual([]);
  });
});

describe("rate limiting (§8)", () => {
  it("blocks the 11th attempt in the window with a doubling wait and records it", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);
    for (let i = 0; i < 10; i++) {
      const r = step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: `wrong-${i}` }, clock);
      expect(r.result.rejection?.code).toBe("invalid_input");
      state = r.state;
    }
    const eleventh = step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: "wrong-x" }, clock);
    expect(eleventh.result.rejection?.code).toBe("rate_limited");
    expect(eleventh.result.rejection?.retryAfterSeconds).toBe(60);
    expect(eleventh.result.events).toEqual([
      { type: "AnswerRejected", gateId: "g.welcome", retryAfterSeconds: 60, at: START, by: ACTOR.userId, actorKind: "human" },
    ]);
    state = eleventh.state;
    // attempts survive fold (rebuilt from AnswerRejected events)
    expect(state.attempts["g.welcome"]).toHaveLength(11);

    const twelfth = step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: "wrong-y" }, clock);
    expect(twelfth.result.rejection?.retryAfterSeconds).toBe(120);
    state = twelfth.state;
    expect(state.attempts["g.welcome"]).toHaveLength(12);
  });

  it("caps the wait at 900s", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);
    let last = 0;
    for (let i = 0; i < 20; i++) {
      const r = step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: `wrong-${i}` }, clock);
      state = r.state;
      if (r.result.rejection?.retryAfterSeconds !== undefined) last = r.result.rejection.retryAfterSeconds;
    }
    expect(last).toBe(900);
  });

  it("expires the rolling window and caps attempts memory at 50", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);
    for (let i = 0; i < 55; i++) {
      ({ state } = step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: `wrong-${i}` }, clock));
    }
    expect(state.attempts["g.welcome"]).toHaveLength(50);
    clock.advance(11 * MIN); // everything on record is now outside the 10-minute window
    const retry = step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: "lanternfish" }, clock);
    expect(retry.result.rejection).toBeUndefined();
    expect(retry.state.solvedGates["g.welcome"]).toBeDefined();
  });

  it("tracks report attempts under the report id, separate from gates", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);
    for (let i = 0; i < 10; i++) {
      ({ state } = step(
        state,
        log,
        { type: "submitReport", reportId: "r.case", groupId: "grp.main", slots: { "s.culprit": "Nope", "s.date": "2000-01-01" } },
        clock
      ));
    }
    const blocked = applyAt(
      state,
      { type: "submitReport", reportId: "r.case", groupId: "grp.main", slots: {} },
      clock,
      log.length
    );
    expect(blocked.rejection?.code).toBe("rate_limited");
    expect(blocked.rejection?.retryAfterSeconds).toBe(60);
    // gate attempts and report attempts are independent buckets
    expect(state.attempts["g.welcome"]).toBeUndefined();
    expect(state.attempts["r.case"]).toHaveLength(10);
  });
});

describe("report grading (§8)", () => {
  it("accepts a fully correct group, never revealing per-slot info on failures", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);
    const wrong = step(
      state,
      log,
      { type: "submitReport", reportId: "r.case", groupId: "grp.main", slots: { "s.culprit": "Mira Vesper", "s.date": "2026-10-30" } },
      clock
    );
    expect(wrong.result.rejection?.code).toBe("invalid_input");
    expect(wrong.result.rejection?.message).not.toContain("s.culprit");
    expect(wrong.result.rejection?.message).not.toContain("s.date");
    expect(JSON.stringify(wrong.result.events)).not.toContain("s.culprit");
    state = wrong.state;

    const right = step(
      state,
      log,
      { type: "submitReport", reportId: "r.case", groupId: "grp.main", slots: { "s.culprit": "mira vesper", "s.date": " 2026-10-31 " } },
      clock
    );
    expect(right.result.rejection).toBeUndefined();
    expect(right.result.result).toEqual({ acceptedGroups: ["grp.main"] });
    expect(right.state.reportGroupsAccepted).toEqual({ "r.case": ["grp.main"] });
    expect(right.state.solvedGates["g.report"]).toBeDefined(); // implicit report gate via fold's final pass
    expect(right.state.score).toBe(50);

    const again = applyAt(right.state, { type: "submitReport", reportId: "r.case", groupId: "grp.main", slots: {} }, clock, log.length);
    expect(again.rejection?.code).toBe("already_solved");
  });

  it("rejects unknown reports and unknown groups with not_found", () => {
    const clock = new TestClock(START);
    expect(
      applyAt(freshState(), { type: "submitReport", reportId: "r.nope", groupId: "grp.main", slots: {} }, clock).rejection?.code
    ).toBe("not_found");
    expect(
      applyAt(freshState(), { type: "submitReport", reportId: "r.case", groupId: "grp.nope", slots: {} }, clock).rejection?.code
    ).toBe("not_found");
  });
});

describe("hints (§8)", () => {
  it("requires tiers in order and charges costs via fold", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);

    const skip = applyAt(state, { type: "requestHint", gateId: "g.welcome", tier: 2 }, clock, log.length);
    expect(skip.rejection?.code).toBe("invalid_input");
    const repeat = applyAt(state, { type: "requestHint", gateId: "g.welcome", tier: 3 }, clock, log.length);
    expect(repeat.rejection?.code).toBe("invalid_input");

    const t1 = step(state, log, { type: "requestHint", gateId: "g.welcome", tier: 1 }, clock);
    expect(t1.result.rejection).toBeUndefined();
    expect(t1.result.result).toEqual({ gateId: "g.welcome", tier: 1, text: expect.any(String), cost: 10 });
    expect(t1.state.hintsUsed).toEqual({ "g.welcome": 1 });
    expect(t1.state.score).toBe(-10);
    state = t1.state;

    const again = applyAt(state, { type: "requestHint", gateId: "g.welcome", tier: 1 }, clock, log.length);
    expect(again.rejection?.code).toBe("invalid_input");
    const skip2 = applyAt(state, { type: "requestHint", gateId: "g.welcome", tier: 3 }, clock, log.length);
    expect(skip2.rejection?.code).toBe("invalid_input");

    const t2 = step(state, log, { type: "requestHint", gateId: "g.welcome", tier: 2 }, clock);
    expect(t2.result.result).toEqual({ gateId: "g.welcome", tier: 2, cost: 25 });
    expect(t2.state.hintsUsed).toEqual({ "g.welcome": 2 });
    expect(t2.state.score).toBe(-35);
    state = t2.state;

    const afterSolve = applyAt(state, { type: "requestHint", gateId: "g.welcome", tier: 1 }, clock, log.length);
    expect(afterSolve.rejection?.code).toBe("invalid_input");
  });

  it("rejects unknown gates and gates that are not yet available", () => {
    const clock = new TestClock(START);
    expect(applyAt(freshState(), { type: "requestHint", gateId: "g.nope", tier: 1 }, clock).rejection?.code).toBe("not_found");
    expect(applyAt(freshState(), { type: "requestHint", gateId: "g.gated", tier: 1 }, clock).rejection?.code).toBe("locked");
  });

  it("rejects tiers with no hint defined in the bundle", () => {
    const clock = new TestClock(START);
    const res = applyAt(freshState(), { type: "requestHint", gateId: "g.evidence", tier: 2 }, clock);
    expect(res.rejection?.code).toBe("invalid_input");
  });
});

describe("world events (§13)", () => {
  it("fires after-triggered events at the START of the next apply, before the action's events, exactly once", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);
    const solve = step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: "lanternfish" }, clock);
    state = solve.state;
    expect(solve.result.events.some((e) => e.type === "WorldEventFired")).toBe(false);

    const next = applyAt(state, { type: "search", query: "anything" }, clock, log.length);
    expect(next.events[0]?.type).toBe("WorldEventFired");
    expect(next.events[0]).toMatchObject({ eventId: "e.welcome-mail" });

    log.push(...next.events);
    const folded = fold(fixtureBundle, log);
    expect(folded.firedEvents.has("e.welcome-mail")).toBe(true);
    expect(folded.unlocked.has("a.mail-welcome")).toBe(true);

    const third = applyAt(folded, { type: "search", query: "again" }, clock, log.length);
    expect(third.events).toEqual([]); // firedEvents prevents refiring
  });

  it("fires at-triggered events once world time reaches the trigger time", () => {
    const clock = new TestClock(START);
    const log = startLog();
    const state = fold(fixtureBundle, log);
    const early = applyAt(state, { type: "search", query: "too soon" }, clock, log.length);
    expect(early.events).toEqual([]);
    clock.advance(29 * MIN);
    const still = applyAt(state, { type: "search", query: "almost" }, clock, log.length);
    expect(still.events).toEqual([]);
    clock.advance(2 * MIN);
    const due = applyAt(state, { type: "search", query: "now" }, clock, log.length);
    expect(due.events.map((e) => (e.type === "WorldEventFired" ? e.eventId : ""))).toContain("e.late");
  });

  it("applies deliverMail unlocks within the same apply that fires the event", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);
    ({ state } = step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: "lanternfish" }, clock));
    const open = step(state, log, { type: "collect", artifactId: "a.mail-welcome" }, clock);
    expect(open.result.rejection).toBeUndefined(); // overlay unlock made it collectible this very apply
    expect(open.result.events.some((e) => e.type === "EvidenceCollected")).toBe(true);
  });
});

describe("implicit gates", () => {
  it("solves evidenceSet gates through collected evidence + matching links (artifact-resolved triples)", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);
    // Solve g.welcome and fire e.welcome-mail so the mail artifact becomes collectible.
    ({ state } = step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: "lanternfish" }, clock));
    ({ state } = step(state, log, { type: "search", query: "fire the event" }, clock));
    const c1 = step(state, log, { type: "collect", artifactId: "a.welcome-doc" }, clock);
    state = c1.state;
    const c2 = step(state, log, { type: "collect", artifactId: "a.mail-welcome" }, clock);
    state = c2.state;
    expect(state.solvedGates["g.evidence"]).toBeUndefined(); // collected but not linked
    const evidenceIds = Object.values(state.evidence).map((e) => e.id);
    const link = step(
      state,
      log,
      { type: "link", from: evidenceIds[0]!, to: evidenceIds[1]!, relation: "supports", confidence: 2 },
      clock
    );
    expect(link.state.solvedGates["g.evidence"]).toBeDefined();
    expect(link.state.score).toBe(100 + 60);
  });

  it("solves terminal gates from TerminalRead events folded into state", () => {
    const clock = new TestClock(START);
    const log = startLog();
    const state = fold(fixtureBundle, log);
    step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: "lanternfish" }, clock);
    const read: GameEvent = {
      type: "TerminalRead",
      host: "shell.tut.iz",
      path: "/home/player/flag.txt",
      at: clock.now(),
      by: ACTOR.userId,
      actorKind: "human",
    };
    log.push(read);
    const folded = fold(fixtureBundle, log);
    expect(folded.readPaths["shell.tut.iz"]?.has("/home/player/flag.txt")).toBe(true);
    expect(folded.solvedGates["g.terminal"]).toEqual({ at: read.at, by: ACTOR.userId });
    expect(folded.score).toBe(100 + 30);
  });

  it("apply checks-then-emits implicit gates for states that were not fold-produced", () => {
    const base = initialState(fixtureBundle, TEAM_ID, START);
    const handMade: GameEvent[] = [
      { type: "EvidenceCollected", evidenceId: "ev.aaa", artifactId: "a.welcome-doc", at: START, by: "u", actorKind: "human" },
      { type: "EvidenceCollected", evidenceId: "ev.bbb", artifactId: "a.mail-welcome", at: START, by: "u", actorKind: "human" },
      { type: "LinkCreated", linkId: "ln.ccc", from: "ev.aaa", to: "ev.bbb", relation: "supports", confidence: 1, at: START, by: "u", actorKind: "human" },
    ];
    replayEvents(fixtureBundle, base, handMade); // no finalize pass: gate still unsolved
    const res = applyAt(base, { type: "search", query: "flush" }, new TestClock(START), handMade.length + 1);
    expect(res.events).toEqual([
      { type: "GateSolved", gateId: "g.evidence", score: 60, at: START, by: ACTOR.userId, actorKind: "human" },
    ]);
    // folding the log with that event solves it exactly once
    const state = fold(fixtureBundle, [...startLog(), ...handMade, ...res.events]);
    expect(state.solvedGates["g.evidence"]).toBeDefined();
    expect(state.score).toBe(60);
  });

  it("requires terminal-gate hosts to be reachable before solving", () => {
    const log = [
      ...startLog(),
      {
        type: "TerminalRead",
        host: "shell.tut.iz",
        path: "/home/player/flag.txt",
        at: START,
        by: ACTOR.userId,
        actorKind: "human",
      } as GameEvent,
    ];
    // g.welcome is NOT solved: shell.tut.iz is unreachable, so no solve.
    const state = fold(fixtureBundle, log);
    expect(state.solvedGates["g.terminal"]).toBeUndefined();
  });
});

describe("terminal action", () => {
  it("gates by service + reachability, accepts non-empty lines, emits no events", () => {
    const clock = new TestClock(START);
    const unknown = applyAt(freshState(), { type: "terminal", host: "ghost.tut.iz", cwd: "/", line: "ls" }, clock);
    expect(unknown.rejection?.code).toBe("locked");
    const notTerminal = applyAt(freshState(), { type: "terminal", host: "mail.tut.iz", cwd: "/", line: "ls" }, clock);
    expect(notTerminal.rejection?.code).toBe("locked");
    const unreachable = applyAt(freshState(), { type: "terminal", host: "shell.tut.iz", cwd: "/", line: "ls" }, clock);
    expect(unreachable.rejection?.code).toBe("locked");

    const log = startLog();
    let state = fold(fixtureBundle, log);
    ({ state } = step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: "lanternfish" }, clock));
    const blank = applyAt(state, { type: "terminal", host: "shell.tut.iz", cwd: "/", line: "   " }, clock, log.length);
    expect(blank.rejection?.code).toBe("invalid_input");
    const ok = applyAt(state, { type: "terminal", host: "shell.tut.iz", cwd: "/home/player", line: "cat flag.txt" }, clock, log.length);
    expect(ok.rejection).toBeUndefined();
    expect(ok.result).toEqual({ accepted: true });
    // The only event is the due world event firing at the start of the apply
    // (e.welcome-mail, triggered by the g.welcome solve); the terminal command
    // itself contributes no events (§19.3 split).
    expect(ok.events).toEqual([
      { type: "WorldEventFired", eventId: "e.welcome-mail", at: START, by: ACTOR.userId, actorKind: "human" },
    ]);
  });

  it("records overlay writes as existence markers in fold", () => {
    const log = [
      ...startLog(),
      {
        type: "TerminalOverlayWrite",
        host: "shell.tut.iz",
        path: "/home/player/notes.txt",
        at: START,
        by: ACTOR.userId,
        actorKind: "human",
      } as GameEvent,
    ];
    const state = fold(fixtureBundle, log);
    expect(state.overlayFs["shell.tut.iz:/home/player/notes.txt"]).toBe("");
  });
});

describe("evaluateCondition", () => {
  it("evaluates logic combinators and gateSolved", () => {
    const log = [
      ...startLog(),
      { type: "GateSolved", gateId: "g.welcome", score: 100, at: START, by: ACTOR.userId, actorKind: "human" } as GameEvent,
    ];
    const state = fold(fixtureBundle, log);
    const now = START;
    expect(state.solvedGates["g.welcome"]).toBeDefined();
    expect(evaluateCondition({ all: [{ gateSolved: "g.welcome" }, { not: { gateSolved: "g.gated" } }] }, state, fixtureBundle, now)).toBe(true);
    expect(evaluateCondition({ any: [{ gateSolved: "g.welcome" }, { gateSolved: "g.gated" }] }, state, fixtureBundle, now)).toBe(true);
    expect(evaluateCondition({ not: { any: [{ gateSolved: "g.welcome" }] } }, state, fixtureBundle, now)).toBe(false);
    const empty = fold(fixtureBundle, startLog());
    expect(evaluateCondition({ all: [{ gateSolved: "g.welcome" }] }, empty, fixtureBundle, now)).toBe(false);
  });

  it("evaluates evidenceCollected against collected artifacts (archived still counts)", () => {
    const clock = new TestClock(START);
    const log = startLog();
    const collected = step(fold(fixtureBundle, log), log, { type: "collect", artifactId: "a.welcome-doc" }, clock);
    const archived = step(collected.state, log, { type: "archiveEvidence", evidenceId: (collected.result.result as { evidenceId: string }).evidenceId }, clock);
    expect(evaluateCondition({ evidenceCollected: "a.welcome-doc" }, archived.state, fixtureBundle, START)).toBe(true);
    expect(evaluateCondition({ evidenceCollected: "a.mail-welcome" }, archived.state, fixtureBundle, START)).toBe(false);
  });

  it("evaluates factEstablished from accepted report-group slots", () => {
    const clock = new TestClock(START);
    const log = startLog();
    const r = step(
      fold(fixtureBundle, log),
      log,
      { type: "submitReport", reportId: "r.case", groupId: "grp.main", slots: { "s.culprit": "Mira Vesper", "s.date": "2026-10-31" } },
      clock
    );
    expect(evaluateCondition({ factEstablished: "f.culprit" }, r.state, fixtureBundle, START)).toBe(true);
    expect(evaluateCondition({ factEstablished: "f.date" }, r.state, fixtureBundle, START)).toBe(true);
    expect(evaluateCondition({ factEstablished: "f.other" }, r.state, fixtureBundle, START)).toBe(false);
  });

  it("evaluates timeReached against world time (epoch + elapsed) and teamSizeAtLeast conservatively", () => {
    const state = freshState();
    // world time at START is exactly the epoch (00:00); 10 minutes later it is 00:10.
    expect(evaluateCondition({ timeReached: EPOCH }, state, fixtureBundle, START)).toBe(true);
    expect(evaluateCondition({ timeReached: "2026-11-01T00:10:00Z" }, state, fixtureBundle, START)).toBe(false);
    const clock = new TestClock(START);
    clock.advance(10 * MIN);
    expect(evaluateCondition({ timeReached: "2026-11-01T00:10:00Z" }, state, fixtureBundle, clock.now())).toBe(true);
    expect(evaluateCondition({ teamSizeAtLeast: 1 }, state, fixtureBundle, START)).toBe(true);
    expect(evaluateCondition({ teamSizeAtLeast: 2 }, state, fixtureBundle, START)).toBe(false);
  });
});

describe("isWorldComplete and a full playthrough", () => {
  it("plays the fixture world to completion", () => {
    const clock = new TestClock(START);
    const log = startLog();
    let state = fold(fixtureBundle, log);
    expect(isWorldComplete(fixtureBundle, state)).toBe(false);

    // 1. wrong answer, then the right one (records one attempt).
    ({ state } = step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: "jellyfish" }, clock));
    ({ state } = step(state, log, { type: "submitAnswer", gateId: "g.welcome", answer: "  LANTERNFISH  " }, clock));
    expect(state.score).toBe(100);

    // 2. apply once so e.welcome-mail fires, then collect both artifacts and link them.
    ({ state } = step(state, log, { type: "search", query: "flush" }, clock));
    const c1 = step(state, log, { type: "collect", artifactId: "a.welcome-doc" }, clock);
    state = c1.state;
    const c2 = step(state, log, { type: "collect", artifactId: "a.mail-welcome" }, clock);
    state = c2.state;
    const ids = Object.values(state.evidence).map((e) => e.id);
    ({ state } = step(state, log, { type: "link", from: ids[0]!, to: ids[1]!, relation: "supports", confidence: 2 }, clock));

    // 3. hints on g.welcome (tier 1 + 2), then the gated follow-up gate.
    ({ state } = step(state, log, { type: "requestHint", gateId: "g.welcome", tier: 1 }, clock));
    ({ state } = step(state, log, { type: "requestHint", gateId: "g.welcome", tier: 2 }, clock));
    step(state, log, { type: "submitAnswer", gateId: "g.gated", answer: "OPENSEASON" }, clock);

    // 4. read the flag on the terminal host (TerminalRead comes from exec via the server).
    log.push({
      type: "TerminalRead",
      host: "shell.tut.iz",
      path: "/home/player/flag.txt",
      at: clock.now(),
      by: ACTOR.userId,
      actorKind: "human",
    });
    state = fold(fixtureBundle, log);

    // 5. file the report.
    const report = step(
      state,
      log,
      { type: "submitReport", reportId: "r.case", groupId: "grp.main", slots: { "s.culprit": "Mira Vesper", "s.date": "2026-10-31" } },
      clock
    );
    state = report.state;

    expect(state.solvedGates["g.welcome"]).toBeDefined();
    expect(state.solvedGates["g.gated"]).toBeDefined();
    expect(state.solvedGates["g.evidence"]).toBeDefined();
    expect(state.solvedGates["g.terminal"]).toBeDefined();
    expect(state.solvedGates["g.report"]).toBeDefined();
    expect(state.score).toBe(100 + 40 + 60 + 30 + 50 - 10 - 25);
    expect(isWorldComplete(fixtureBundle, state)).toBe(true);
  });
});
