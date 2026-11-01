import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Action, GameEvent, LinkRelation } from "@iz/schema";
import { apply, finalizeImplicitGates, fold, initialState, replayEvents, sessionStartEvent } from "../src/index.js";
import type { RuntimeState } from "@iz/schema";
import { TestClock, ACTOR, START, TEAM_ID, fixtureBundle } from "./helpers.js";

/**
 * Property tests (§9): for random valid action sequences,
 *   1. fold(all events) equals the state reached by sequential apply-with-fold,
 *      and re-folding is pure (does not mutate the log) and reproducible;
 *   2. folding in chunks equals folding all at once;
 *   3. running the same sequence from scratch reproduces the identical log and
 *      state (apply is deterministic given the same seqs and clock).
 */

const URLS = [
  "archive.tut.iz/docs/welcome",
  "archive.tut.iz/docs/hidden",
  "mail.tut.iz/inbox/hello",
  "shell.tut.iz/home/player",
  "vault.tut.iz/note",
  "ghost.tut.iz/nowhere",
  "archive.tut.iz/missing",
  "not even a url",
];

const ANSWERS = ["lanternfish", "  LANTERNFISH  ", "jellyfish", "openseason", "wrong-1", "wrong-2"];
const CLAIM_TEXTS = ["Mira sent the mail.", "The ledger contradicts the log.", "Maybe the vault holds the key."];
const RELATIONS: LinkRelation[] = ["supports", "contradicts", "same_identity", "precedes", "derived_from"];
const GATE_IDS = ["g.welcome", "g.gated", "g.evidence", "g.report", "g.terminal", "g.nope"];
const REPORT_SLOTS: Record<string, string>[] = [
  { "s.culprit": "Mira Vesper", "s.date": "2026-10-31" },
  { "s.culprit": "mira vesper", "s.date": " 2026-10-31 " },
  { "s.culprit": "Mira Vesper" },
  { "s.culprit": "Someone Else", "s.date": "2026-10-31" },
  {},
];
const TERMINAL_HOSTS = ["shell.tut.iz", "mail.tut.iz", "ghost.tut.iz"];
const TERMINAL_LINES = ["cat /home/player/flag.txt", "ls", "connect vault.tut.iz"];

type Spec =
  | { t: "open"; i: number }
  | { t: "search"; i: number; withHost: number }
  | { t: "collect"; i: number; frag: number }
  | { t: "archive"; i: number }
  | { t: "claim"; i: number; priv: number }
  | { t: "edit"; i: number; text: number }
  | { t: "link"; from: number; to: number; rel: number; conf: number }
  | { t: "unlink"; i: number }
  | { t: "answer"; g: number; a: number }
  | { t: "report"; i: number }
  | { t: "hint"; g: number; tier: number }
  | { t: "term"; h: number; line: number }
  | { t: "tick"; minutes: number };

const specArb: fc.Arbitrary<Spec> = fc.oneof(
  fc.record({ t: fc.constant<"open">("open"), i: fc.nat(URLS.length - 1) }),
  fc.record({ t: fc.constant<"search">("search"), i: fc.nat(3), withHost: fc.nat(1) }),
  fc.record({ t: fc.constant<"collect">("collect"), i: fc.nat(3), frag: fc.nat(2) }),
  fc.record({ t: fc.constant<"archive">("archive"), i: fc.nat(4) }),
  fc.record({ t: fc.constant<"claim">("claim"), i: fc.nat(CLAIM_TEXTS.length - 1), priv: fc.nat(1) }),
  fc.record({ t: fc.constant<"edit">("edit"), i: fc.nat(3), text: fc.nat(CLAIM_TEXTS.length - 1) }),
  fc.record({ t: fc.constant<"link">("link"), from: fc.nat(5), to: fc.nat(5), rel: fc.nat(RELATIONS.length - 1), conf: fc.nat(2) }),
  fc.record({ t: fc.constant<"unlink">("unlink"), i: fc.nat(4) }),
  fc.record({ t: fc.constant<"answer">("answer"), g: fc.nat(GATE_IDS.length - 1), a: fc.nat(ANSWERS.length - 1) }),
  fc.record({ t: fc.constant<"report">("report"), i: fc.nat(REPORT_SLOTS.length - 1) }),
  fc.record({ t: fc.constant<"hint">("hint"), g: fc.nat(GATE_IDS.length - 1), tier: fc.nat(2) }),
  fc.record({ t: fc.constant<"term">("term"), h: fc.nat(TERMINAL_HOSTS.length - 1), line: fc.nat(TERMINAL_LINES.length - 1) }),
  fc.record({ t: fc.constant<"tick">("tick"), minutes: fc.nat(90) })
);

const FRAGMENTS = [undefined, { kind: "lines" as const, from: 1, to: 2 }, { kind: "lines" as const, from: 3, to: 4 }];
const ARTIFACTS = ["a.welcome-doc", "a.mail-welcome", "a.hidden-doc", "a.nope"];

interface Ctx {
  evidence: string[];
  claims: string[];
  links: string[];
}

function pick<T>(arr: readonly T[], i: number, fallback: T): T {
  if (arr.length === 0) return fallback;
  return arr[i % arr.length]!;
}

function toAction(spec: Spec, ctx: Ctx): Action | null {
  switch (spec.t) {
    case "open":
      return { type: "open", url: pick(URLS, spec.i, URLS[0]!) };
    case "search":
      return spec.withHost === 1
        ? { type: "search", query: "lanternfish", host: "archive.tut.iz" }
        : { type: "search", query: "lanternfish" };
    case "collect": {
      const artifactId = pick(ARTIFACTS, spec.i, ARTIFACTS[0]!);
      const fragment = FRAGMENTS[spec.frag % FRAGMENTS.length];
      return fragment === undefined ? { type: "collect", artifactId } : { type: "collect", artifactId, fragment };
    }
    case "archive":
      return { type: "archiveEvidence", evidenceId: pick(ctx.evidence, spec.i, "ev.none") };
    case "claim": {
      const text = pick(CLAIM_TEXTS, spec.i, CLAIM_TEXTS[0]!);
      return spec.priv === 1 ? { type: "claim", text, private: true } : { type: "claim", text, private: false };
    }
    case "edit":
      return { type: "editClaim", claimId: pick(ctx.claims, spec.i, "cl.none"), text: pick(CLAIM_TEXTS, spec.text, CLAIM_TEXTS[0]!) };
    case "link": {
      const pool = [...ctx.evidence, ...ctx.claims, "ev.none", "cl.none"];
      return {
        type: "link",
        from: pick(pool, spec.from, "ev.none"),
        to: pick(pool, spec.to, "cl.none"),
        relation: pick(RELATIONS, spec.rel, "supports"),
        confidence: ((spec.conf % 3) + 1) as 1 | 2 | 3,
      };
    }
    case "unlink":
      return { type: "unlink", linkId: pick(ctx.links, spec.i, "ln.none") };
    case "answer":
      return { type: "submitAnswer", gateId: pick(GATE_IDS, spec.g, GATE_IDS[0]!), answer: pick(ANSWERS, spec.a, ANSWERS[0]!) };
    case "report":
      return { type: "submitReport", reportId: "r.case", groupId: "grp.main", slots: pick(REPORT_SLOTS, spec.i, REPORT_SLOTS[0]!) };
    case "hint":
      return { type: "requestHint", gateId: pick(GATE_IDS, spec.g, GATE_IDS[0]!), tier: ((spec.tier % 3) + 1) as 1 | 2 | 3 };
    case "term":
      return {
        type: "terminal",
        host: pick(TERMINAL_HOSTS, spec.h, TERMINAL_HOSTS[0]!),
        cwd: "/home/player",
        line: pick(TERMINAL_LINES, spec.line, TERMINAL_LINES[0]!),
      };
    case "tick":
      return null; // handled by the runner (clock advance)
  }
}

function runSpecs(specs: Spec[]): { state: RuntimeState; log: GameEvent[] } {
  const clock = new TestClock(START);
  const ctx: Ctx = { evidence: [], claims: [], links: [] };
  let state = initialState(fixtureBundle, TEAM_ID, START);
  const log: GameEvent[] = [sessionStartEvent(fixtureBundle, TEAM_ID, START, ACTOR)];
  for (const spec of specs) {
    if (spec.t === "tick") {
      clock.advance((spec.minutes + 1) * 60_000);
      continue;
    }
    const action = toAction(spec, ctx);
    if (action === null) continue;
    const result = foldableApply(action, state, clock, log.length);
    for (const event of result) {
      log.push(event);
      if (event.type === "EvidenceCollected" && !ctx.evidence.includes(event.evidenceId)) ctx.evidence.push(event.evidenceId);
      if (event.type === "ClaimCreated" && !ctx.claims.includes(event.claimId)) ctx.claims.push(event.claimId);
      if (event.type === "LinkCreated" && !ctx.links.includes(event.linkId)) ctx.links.push(event.linkId);
    }
    state = fold(fixtureBundle, log);
  }
  return { state, log };
}

function foldableApply(action: Action, state: RuntimeState, clock: TestClock, seq: number): GameEvent[] {
  return apply(fixtureBundle, state, action, ACTOR, clock, seq).events;
}

const specsArb = fc.array(specArb, { maxLength: 40 });

describe("runtime properties (§9)", () => {
  it("fold(all events) equals sequential apply-with-fold, chunks included, deterministically", () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const { state, log } = runSpecs(specs);

        // 1. fold(all) equals the loop's final state; folding is pure over the log.
        const refolded = fold(fixtureBundle, [...log]);
        expect(refolded).toEqual(state);

        // 2. chunked folding: fold(prefix) then replay(suffix) then the final
        //    implicit-gate pass equals fold(all).
        const k = Math.max(1, Math.floor(log.length / 2));
        const chunked = initialState(fixtureBundle, TEAM_ID, START);
        replayEvents(fixtureBundle, chunked, log.slice(0, k));
        replayEvents(fixtureBundle, chunked, log.slice(k));
        const last = log[log.length - 1]!;
        finalizeImplicitGates(fixtureBundle, chunked, last.at, last.by);
        expect(chunked).toEqual(state);

        // 3. determinism: a fresh run of the same sequence reproduces both.
        const again = runSpecs(specs);
        expect(again.log).toEqual(log);
        expect(again.state).toEqual(state);
      }),
      { seed: 20261102, numRuns: 50 }
    );
  });

  it("never leaves an id-bearing event without a deterministic id shape", () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const { log } = runSpecs(specs);
        for (const event of log) {
          if (event.type === "EvidenceCollected") expect(event.evidenceId).toMatch(/^ev\.[0-9a-f]{16}$/);
          if (event.type === "ClaimCreated") expect(event.claimId).toMatch(/^cl\.[0-9a-f]{16}$/);
          if (event.type === "LinkCreated") expect(event.linkId).toMatch(/^ln\.[0-9a-f]{16}$/);
        }
        const ids = log.flatMap((e) =>
          e.type === "EvidenceCollected" ? [e.evidenceId] : e.type === "ClaimCreated" ? [e.claimId] : e.type === "LinkCreated" ? [e.linkId] : []
        );
        expect(new Set(ids).size).toBe(ids.length); // no collisions
      }),
      { seed: 4711, numRuns: 30 }
    );
  });
});
