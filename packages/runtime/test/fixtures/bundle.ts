import type { WorldBundle } from "@iz/schema";
import { normalizeAnswer, SlotNormalizers } from "@iz/schema";
import { hashAnswer } from "../../src/hash.js";

/**
 * Minimal WorldBundle fixture for runtime tests. Answer hashes are REAL: they
 * are computed here with hashAnswer + normalizeAnswer exactly like the
 * compiler would (§6.4), so the runtime's grading path is exercised for real.
 *
 * Shape of the little world:
 * - archive.tut.iz (no requires): a.welcome-doc visible from t0.
 * - mail.tut.iz (no requires): a.mail-welcome is unlock-gated — it becomes
 *   visible when world event e.welcome-mail fires (trigger: after g.welcome).
 * - shell.tut.iz (terminal, requires g.welcome): reachable via condition; the
 *   g.terminal gate checks a TerminalRead of /home/player/flag.txt.
 * - vault.tut.iz (requires g.never — a gate that does not exist, so never
 *   satisfied by condition): reachable only via e.late's revealHosts (trigger:
 *   at world time 00:30).
 */
export const FIXTURE_SALT = "iz-fixture-salt-0001";
export const TEAM_ID = "team.alpha";
export const START = "2026-11-02T09:00:00Z";
export const EPOCH = "2026-11-01T00:00:00Z";

export const WELCOME_ANSWER = "lanternfish";
export const GATED_ANSWER = "openseason";

const norm = ["nfkc", "lower", "trim", "collapse"] as const;

const doc = (value: string) => ({
  type: "root" as const,
  children: [{ type: "paragraph" as const, children: [{ type: "text" as const, value }] }],
});

export const fixtureBundle: WorldBundle = {
  world: {
    id: "tut",
    version: "1.0.0",
    format: "iz/1",
    title: "Fixture World",
    summary: "A tiny world for runtime tests.",
    license: "CC-BY-4.0",
    hostSuffix: "tut",
    clock: { mode: "session", epoch: EPOCH },
    hosts: [
      { host: "archive.tut.iz", service: "archive", title: "The Archive" },
      { host: "mail.tut.iz", service: "mail", title: "DEADLETTER" },
      { host: "shell.tut.iz", service: "terminal", title: "NODE TERMINAL", requires: { gateSolved: "g.welcome" } },
      { host: "vault.tut.iz", service: "archive", title: "Vault", requires: { gateSolved: "g.never" } },
    ],
    entry: "archive.tut.iz/docs/welcome",
    reports: ["r.case"],
  },
  entities: [],
  identities: [],
  artifacts: [
    {
      id: "a.welcome-doc",
      host: "archive.tut.iz",
      path: "/docs/welcome",
      kind: "archive-document",
      title: "Welcome",
      body: "Welcome to the intronet. The harbor hides a lanternfish.",
      ast: doc("Welcome to the intronet. The harbor hides a lanternfish."),
      meta: {},
      collectible: true,
    },
    {
      id: "a.hidden-doc",
      host: "archive.tut.iz",
      path: "/docs/hidden",
      kind: "archive-document",
      title: "Hidden note",
      body: "Unlocked by solving g.welcome.",
      ast: doc("Unlocked by solving g.welcome."),
      meta: {},
      collectible: true,
    },
    {
      id: "a.mail-welcome",
      host: "mail.tut.iz",
      path: "/inbox/hello",
      kind: "mail-message",
      title: "Hello, player",
      body: "Delivered by the e.welcome-mail world event.",
      ast: doc("Delivered by the e.welcome-mail world event."),
      meta: {},
      collectible: true,
    },
    {
      id: "a.vault-note",
      host: "vault.tut.iz",
      path: "/note",
      kind: "archive-document",
      title: "Vault note",
      body: "Only reachable after e.late reveals the vault host.",
      ast: doc("Only reachable after e.late reveals the vault host."),
      meta: {},
      collectible: false,
    },
  ],
  gates: [
    {
      id: "g.welcome",
      title: "What sleeps in the harbor?",
      check: {
        kind: "answer",
        normalize: [...norm],
        answerHashes: [hashAnswer(FIXTURE_SALT, "g.welcome", normalizeAnswer(WELCOME_ANSWER, [...norm]))],
      },
      unlocks: ["a.hidden-doc"],
      score: 100,
    },
    {
      id: "g.gated",
      title: "Gated follow-up",
      requires: { gateSolved: "g.welcome" },
      check: {
        kind: "answer",
        normalize: [...norm],
        answerHashes: [hashAnswer(FIXTURE_SALT, "g.gated", normalizeAnswer(GATED_ANSWER, [...norm]))],
      },
      unlocks: [],
      score: 40,
    },
    {
      id: "g.evidence",
      title: "Two artifacts, one story",
      check: {
        kind: "evidenceSet",
        mustCollect: ["a.welcome-doc", "a.mail-welcome"],
        mustLink: [{ from: "a.welcome-doc", to: "a.mail-welcome", relation: "supports" }],
      },
      unlocks: [],
      score: 60,
    },
    {
      id: "g.terminal",
      title: "Read the flag",
      check: { kind: "terminal", mustHaveRead: ["/home/player/flag.txt"], host: "shell.tut.iz" },
      unlocks: [],
      score: 30,
    },
    {
      id: "g.report",
      title: "File the case report",
      check: { kind: "report", report: "r.case" },
      unlocks: [],
      score: 50,
    },
  ],
  reports: [
    {
      id: "r.case",
      title: "Case Report",
      groups: [
        {
          id: "grp.main",
          slots: [
            {
              id: "s.culprit",
              label: "Culprit",
              type: "identity",
              fact: "f.culprit",
              answerHashes: [hashAnswer(FIXTURE_SALT, "s.culprit", normalizeAnswer("Mira Vesper", SlotNormalizers.identity))],
            },
            {
              id: "s.date",
              label: "Date",
              type: "date",
              fact: "f.date",
              answerHashes: [hashAnswer(FIXTURE_SALT, "s.date", normalizeAnswer("2026-10-31", SlotNormalizers.date))],
            },
          ],
        },
      ],
    },
  ],
  hints: [
    { gate: "g.welcome", tier: 1, text: "Think fish.", cost: 10 },
    { gate: "g.welcome", tier: 2, text: "It starts with L.", cost: 25 },
    { gate: "g.evidence", tier: 1, text: "Check the mail.", cost: 10 },
  ],
  events: [
    {
      id: "e.welcome-mail",
      trigger: { kind: "after", gateSolved: "g.welcome" },
      effects: [{ kind: "deliverMail", mailbox: "id.player", message: "a.mail-welcome" }],
    },
    {
      id: "e.late",
      trigger: { kind: "at", time: "2026-11-01T00:30:00Z" },
      effects: [{ kind: "revealHosts", hosts: ["vault.tut.iz"] }],
    },
  ],
  canon: { facts: [], beliefs: [], statements: [], proofs: [] },
  assets: [],
  forge: [],
  mailboxes: [],
  bundleSalt: FIXTURE_SALT,
  bundleHash: "b7e23ec29af22b0b4e41da31e868d57226121c84a1b46e3a0c8a2d3f4e5f6071",
};
