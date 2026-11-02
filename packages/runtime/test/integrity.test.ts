import { describe, expect, it } from "vitest";
import type { Action, GameEvent, WorldBundle } from "@iz/schema";
import { apply, fold, isWorldComplete } from "../src/index.js";
import * as runtime from "../src/index.js";
import { ACTOR, START, TestClock, fixtureBundle, startLog } from "./helpers.js";

const clock = new TestClock(START);
const stamp = { at: START, by: ACTOR.userId, actorKind: ACTOR.kind };
const correctReport: Action = {
  type: "submitReport", reportId: "r.case", groupId: "grp.main",
  slots: { "s.culprit": "Mira Vesper", "s.date": "2026-10-31" },
};
function run(bundle: WorldBundle, log: GameEvent[], action: Action) {
  const before = fold(bundle, log);
  const snapshot = structuredClone(before);
  const result = apply(bundle, before, action, ACTOR, clock, log.length);
  expect(before).toEqual(snapshot);
  log.push(...result.events);
  return { result, state: fold(bundle, log) };
}
function settle(bundle: WorldBundle, log: GameEvent[], effects: GameEvent[]) {
  // Missing API is asserted as a behavior failure before use, not an import error.
  const api = runtime as typeof runtime & {
    settleEvents?: (b: WorldBundle, s: ReturnType<typeof fold>, e: readonly GameEvent[], a: typeof ACTOR, c: TestClock) => GameEvent[];
  };
  expect(api.settleEvents, "terminal effects need an emitting runtime settlement boundary").toBeTypeOf("function");
  return api.settleEvents!(bundle, fold(bundle, log), effects, ACTOR, clock);
}

describe("recorded gate integrity", () => {
  it("fold never invents gates, unlocks or score from evidence, reports or terminal reads", () => {
    const log: GameEvent[] = [...startLog(),
      { type: "EvidenceCollected", evidenceId: "ev.a", artifactId: "a.welcome-doc", ...stamp },
      { type: "EvidenceCollected", evidenceId: "ev.b", artifactId: "a.mail-welcome", ...stamp },
      { type: "LinkCreated", linkId: "ln.a", from: "ev.a", to: "ev.b", relation: "supports", confidence: 1, ...stamp },
      { type: "ReportGroupAccepted", reportId: "r.case", groupId: "grp.main", ...stamp },
      { type: "TerminalRead", host: "shell.tut.iz", path: "/home/player/flag.txt", ...stamp },
    ];
    const state = fold(fixtureBundle, log);
    expect(state.solvedGates).toEqual({});
    expect(state.unlocked).toEqual(new Set());
    expect(state.score).toBe(0);
  });

  it("emits evidence gates after the link action that satisfies them", () => {
    const log = startLog();
    run(fixtureBundle, log, { type: "submitAnswer", gateId: "g.welcome", answer: "lanternfish" });
    const a = run(fixtureBundle, log, { type: "collect", artifactId: "a.welcome-doc" });
    const b = run(fixtureBundle, log, { type: "collect", artifactId: "a.mail-welcome" });
    const from = (a.result.result as { evidenceId: string }).evidenceId;
    const to = (b.result.result as { evidenceId: string }).evidenceId;
    const linked = run(fixtureBundle, log, { type: "link", from, to, relation: "supports", confidence: 2 });
    expect(linked.result.events.map(e => e.type)).toEqual(["LinkCreated", "GateSolved"]);
    expect(linked.result.events[1]).toEqual({ type: "GateSolved", gateId: "g.evidence", score: 60, ...stamp });
    expect(linked.state.score).toBe(160);
  });

  it("settles interpreter effects into a recorded terminal GateSolved without changing input", () => {
    const log = startLog();
    run(fixtureBundle, log, { type: "submitAnswer", gateId: "g.welcome", answer: "lanternfish" });
    const effects: GameEvent[] = [{ type: "TerminalRead", host: "shell.tut.iz", path: "/home/player/flag.txt", ...stamp }];
    const batch = settle(fixtureBundle, log, effects);
    expect(effects).toHaveLength(1);
    expect(batch).toEqual([...effects, { type: "GateSolved", gateId: "g.terminal", score: 30, ...stamp }]);
    expect(fold(fixtureBundle, [...log, ...batch]).score).toBe(130);
  });

  it("settles due event unlocks and reverse-ordered implicit requires to a fixpoint before the action", () => {
    const bundle = structuredClone(fixtureBundle);
    bundle.gates = [
      { id: "g.third", title: "third", requires: { gateSolved: "g.second" }, check: { kind: "evidenceSet", mustCollect: [], mustLink: [] }, unlocks: [], score: 3 },
      { id: "g.second", title: "second", requires: { gateSolved: "g.first" }, check: { kind: "evidenceSet", mustCollect: [], mustLink: [] }, unlocks: [], score: 2 },
      { id: "g.first", title: "first", check: { kind: "terminal", host: "vault.tut.iz", mustHaveRead: ["/note"] }, unlocks: [], score: 1 },
    ];
    bundle.world.hosts.find(h => h.host === "vault.tut.iz")!.service = "terminal";
    const log: GameEvent[] = [...startLog(), { type: "TerminalRead", host: "vault.tut.iz", path: "/note", ...stamp }];
    const lateClock = new TestClock("2026-11-02T09:31:00Z");
    const result = apply(bundle, fold(bundle, log), { type: "open", url: "vault.tut.iz/note" }, ACTOR, lateClock, log.length);
    expect(result.events.map(e => e.type)).toEqual(["WorldEventFired", "GateSolved", "GateSolved", "GateSolved", "ArtifactViewed"]);
    expect(result.events.filter(e => e.type === "GateSolved").map(e => e.gateId)).toEqual(["g.first", "g.second", "g.third"]);
    expect(result.events.every(e => e.at === lateClock.now())).toBe(true);
    expect(fold(bundle, [...log, ...result.events]).score).toBe(6);
  });

  it("emits the complete report gate only after all authored groups are accepted", () => {
    const bundle = structuredClone(fixtureBundle);
    bundle.reports[0]!.groups.push({ ...structuredClone(bundle.reports[0]!.groups[0]!), id: "grp.second" });
    const log = startLog();
    const first = run(bundle, log, correctReport);
    expect(first.result.events.map(e => e.type)).toEqual(["ReportGroupAccepted"]);
    expect(first.state.solvedGates["g.report"]).toBeUndefined();
    const second = run(bundle, log, { ...correctReport, groupId: "grp.second" });
    expect(second.result.events.map(e => e.type)).toEqual(["ReportGroupAccepted", "GateSolved"]);
    expect(second.state.score).toBe(50);
    const incomplete = { ...second.state, reportGroupsAccepted: { "r.case": ["grp.main"] }, solvedGates: Object.fromEntries(bundle.gates.map(g => [g.id, { at: START, by: ACTOR.userId }])) };
    expect(isWorldComplete(bundle, incomplete)).toBe(false);
  });
});

describe("runtime authorization and replayable costs", () => {
  it("never grades report groups before their report gate requires, including guesses and hidden reports", () => {
    const bundle = structuredClone(fixtureBundle);
    bundle.gates.find(g => g.id === "g.report")!.requires = { gateSolved: "g.welcome" };
    const log = startLog();
    for (const action of [correctReport, { ...correctReport, slots: {} }]) {
      const result = run(bundle, log, action).result;
      expect(result.rejection?.code).toBe("locked");
      expect(result.events).toEqual([]);
    }
    bundle.gates = bundle.gates.filter(g => g.id !== "g.report");
    const hidden = run(bundle, log, correctReport).result;
    expect(hidden.rejection?.code).toBe("locked");
    expect(hidden.events).toEqual([]);
  });

  it("counts successful answer and report attempts from answer-free events and returns accepted status", () => {
    const log = startLog();
    const answer = run(fixtureBundle, log, { type: "submitAnswer", gateId: "g.welcome", answer: "lanternfish" });
    expect(answer.result.result).toEqual({ accepted: true, solved: true });
    expect(answer.state.attempts["g.welcome"]).toEqual([{ at: START, by: ACTOR.userId }]);
    const report = run(fixtureBundle, log, correctReport);
    expect(report.state.attempts["r.case"]).toEqual([{ at: START, by: ACTOR.userId }]);
    const text = JSON.stringify(log);
    for (const secret of ["lanternfish", "Mira Vesper", "2026-10-31", "answerHashes", "slots"]) expect(text).not.toContain(secret);
  });

  it("fails closed for invalid clocks rather than bypassing brute-force limits", () => {
    const state = fold(fixtureBundle, startLog());
    const result = apply(fixtureBundle, state, { type: "submitAnswer", gateId: "g.welcome", answer: "lanternfish" }, ACTOR, new TestClock("invalid"), 1);
    expect(result.rejection?.code).toBe("invalid_input");
    expect(result.events).toEqual([]);
  });

  it("does not charge hint tiers twice when the same recorded event is replayed", () => {
    const log = startLog();
    for (const tier of [1, 2] as const) run(fixtureBundle, log, { type: "requestHint", gateId: "g.welcome", tier });
    const hint = log.find(e => e.type === "HintRequested")!;
    expect(fold(fixtureBundle, [...log, hint]).score).toBe(-35);
  });

  it("keeps optional sequence ids unique through link removal and recreation", () => {
    const log = startLog();
    const a = run(fixtureBundle, log, { type: "claim", text: "first", private: false });
    const b = run(fixtureBundle, log, { type: "claim", text: "second", private: false });
    const action: Action = { type: "link", from: (a.result.result as { claimId: string }).claimId, to: (b.result.result as { claimId: string }).claimId, relation: "supports", confidence: 1 };
    const first = apply(fixtureBundle, fold(fixtureBundle, log), action, ACTOR, clock);
    log.push(...first.events);
    run(fixtureBundle, log, { type: "unlink", linkId: (first.result as { linkId: string }).linkId });
    const second = apply(fixtureBundle, fold(fixtureBundle, log), action, ACTOR, clock);
    expect(second.result).not.toEqual(first.result);
  });

  it.each(["../docs/welcome", "%2e%2e/docs/welcome", "//docs/welcome", "docs\\welcome", "docs/welcome?x=1"])("rejects unsafe in-game path %s", path => {
    const result = run(fixtureBundle, startLog(), { type: "open", url: `archive.tut.iz/${path}` }).result;
    expect(result.rejection?.code).toBe("invalid_input");
    expect(result.events).toEqual([]);
  });

  it("rejects traversing terminal cwd and never accepts commands on locked hosts", () => {
    const log = startLog();
    const locked = run(fixtureBundle, log, { type: "terminal", host: "shell.tut.iz", cwd: "/", line: "cat /home/player/flag.txt" });
    expect(locked.result.rejection?.code).toBe("locked");
    run(fixtureBundle, log, { type: "submitAnswer", gateId: "g.welcome", answer: "lanternfish" });
    const traversal = run(fixtureBundle, log, { type: "terminal", host: "shell.tut.iz", cwd: "/../", line: "ls" });
    expect(traversal.result.rejection?.code).toBe("invalid_input");
  });

  it("does not let forged literal artifact link endpoints satisfy evidenceSet triples", () => {
    const log: GameEvent[] = [...startLog(),
      { type: "EvidenceCollected", evidenceId: "ev.a", artifactId: "a.welcome-doc", ...stamp },
      { type: "EvidenceCollected", evidenceId: "ev.b", artifactId: "a.mail-welcome", ...stamp },
      { type: "LinkCreated", linkId: "ln.a", from: "a.welcome-doc", to: "a.mail-welcome", relation: "supports", confidence: 1, ...stamp },
    ];
    const result = run(fixtureBundle, log, { type: "search", query: "settle" });
    expect(result.state.solvedGates["g.evidence"]).toBeUndefined();
  });

  it("requires explicit completion terminal metadata and a recorded read after all gates", () => {
    const bundle = structuredClone(fixtureBundle);
    bundle.artifacts.push({ ...bundle.artifacts[0]!, id: "a.ending", host: "shell.tut.iz", path: "/etc/motd", kind: "terminal-file", meta: { completion: "terminalRead" } });
    const log: GameEvent[] = [...startLog(), ...bundle.gates.map(g => ({ type: "GateSolved" as const, gateId: g.id, score: g.score, ...stamp })), { type: "ReportGroupAccepted", reportId: "r.case", groupId: "grp.main", ...stamp }];
    expect(isWorldComplete(bundle, fold(bundle, log))).toBe(false);
    log.push({ type: "TerminalRead", host: "shell.tut.iz", path: "/etc/motd", ...stamp });
    expect(isWorldComplete(bundle, fold(bundle, log))).toBe(true);
  });
});
