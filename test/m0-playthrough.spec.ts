import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WorldBundle, type Clock, type Actor, type Action, type GameEvent, type RuntimeState } from "@iz/schema";
import { apply, fold, isWorldComplete } from "@iz/runtime";

/**
 * M0 gate condition 2 (§19.1): a test plays the tutorial headless, by
 * actions only, from entry to completion — no UI, no server, no mocks.
 * The bundle must be compiled first: `pnpm run worlds:build`.
 */

const BUNDLE_PATH = resolve("dist/worlds/tutorial@1.0.0.json");

function loadBundle(): WorldBundle {
  expect(
    existsSync(BUNDLE_PATH),
    `bundle missing — run \`pnpm run worlds:build\` (${BUNDLE_PATH})`
  ).toBe(true);
  return WorldBundle.parse(JSON.parse(readFileSync(BUNDLE_PATH, "utf8")));
}

const T0 = Date.parse("2026-11-02T09:00:00.000Z");
const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const clock = (t: string): Clock => ({ now: () => t });
const actor: Actor = { userId: "user-test", kind: "human" };

/** Drive the tutorial by actions only; throws on any rejection. */
function playthrough(): { bundle: WorldBundle; log: GameEvent[]; final: RuntimeState } {
  const bundle = loadBundle();
  const log: GameEvent[] = [];
  let seq = 1;
  let state = fold(bundle, log);

  const run = (action: Action, t: string): RuntimeState => {
    const r = apply(bundle, state, action, actor, clock(t), seq++);
    if (r.rejection) throw new Error(`${action.type} rejected: ${r.rejection.code} ${r.rejection.message}`);
    log.push(...r.events);
    state = fold(bundle, log);
    return state;
  };

  const mailHost = bundle.world.hosts.find((h) => h.service === "mail")!.host;

  // 1. Open the entry repo. Nothing is solved yet.
  run({ type: "open", url: bundle.world.entry }, at(0));

  // 2. Find the rotation commit artifact, open and collect it.
  //    The evidenceSet gate g.first-commit solves implicitly.
  const commit = bundle.artifacts.find((a) => a.kind === "commit");
  expect(commit, "tutorial has a rotation commit artifact").toBeTruthy();
  run({ type: "open", url: `${commit!.host}${commit!.path}` }, at(1));
  run({ type: "collect", artifactId: commit!.id }, at(2));
  expect(state.solvedGates["g.first-commit"]).toBeDefined();

  // 3. The mail host is now reachable via its requires condition; collect the hint mail.
  run({ type: "open", url: `${mailHost}/` }, at(3));
  const hintMail = bundle.artifacts.find((a) => a.kind === "mail-message");
  expect(hintMail, "tutorial has a hint mail artifact").toBeTruthy();
  run({ type: "collect", artifactId: hintMail!.id }, at(4));

  // 4. File the report for g.mailbox. The identity slot accepts the display name.
  const report = bundle.reports.find((r) => r.id === "r.who-holds");
  expect(report, "tutorial has report r.who-holds").toBeTruthy();
  const group = report!.groups[0]!;
  const slots: Record<string, string> = {};
  for (const slot of group.slots) {
    if (slot.type === "choice") slots[slot.id] = slot.options?.[0] ?? "";
    else slots[slot.id] = "Odile Brandt";
  }
  run({ type: "submitReport", reportId: report!.id, groupId: group.id, slots }, at(5));
  expect(state.reportGroupsAccepted["r.who-holds"]).toContain(group.id);
  expect(state.solvedGates["g.mailbox"]).toBeDefined();

  // 5. The printer passphrase, derived from the collected evidence: cat + year.
  run({ type: "submitAnswer", gateId: "g.printer", answer: "biscuit2009" }, at(6));
  expect(state.solvedGates["g.printer"]).toBeDefined();

  expect(isWorldComplete(bundle, state)).toBe(true);
  expect(state.score).toBe(300); // three gates at 100 points, no hints used
  return { bundle, log, final: state };
}

describe("M0 headless tutorial playthrough (actions only)", () => {
  it("completes the tutorial from entry to world-complete", () => {
    const { log } = playthrough();
    const types = log.map((e) => e.type);
    expect(types[0]).toBe("SessionStarted");
    expect(types).toContain("ArtifactViewed");
    expect(types).toContain("EvidenceCollected");
    expect(types).toContain("ReportGroupAccepted");
    expect(types).toContain("GateSolved");
    // Canon and answers never leak into the event log.
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain("biscuit2009");
    expect(serialized).not.toContain("answerHashes");
  });

  it("is deterministic: two runs produce identical event logs", () => {
    const a = playthrough();
    const b = playthrough();
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
  });

  it("rejects a wrong answer, then accepts an equivalent one", () => {
    const bundle = loadBundle();
    const log: GameEvent[] = [];
    let seq = 1;
    let state = fold(bundle, log);
    const run = (action: Action, t: string) => {
      const r = apply(bundle, state, action, actor, clock(t), seq++);
      log.push(...r.events);
      state = fold(bundle, log);
      return r;
    };
    const commit = bundle.artifacts.find((a) => a.kind === "commit")!;
    run({ type: "open", url: bundle.world.entry }, at(0));
    run({ type: "collect", artifactId: commit.id }, at(1));
    const wrong = run({ type: "submitAnswer", gateId: "g.printer", answer: "letmein" }, at(2));
    expect(wrong.rejection?.code).toBe("invalid_input");
    const right = run({ type: "submitAnswer", gateId: "g.printer", answer: "Biscuit-2009!" }, at(3));
    expect(right.rejection).toBeUndefined();
    expect(state.solvedGates["g.printer"]).toBeDefined();
  });
});
