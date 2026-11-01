---
name: blind-playtesting
description: Use to playtest a world without canon access, with the oracle agent, the reference agent, or a human script, and to report stuck points. Captures scorer JSON and event logs for INTRANET ZERO worlds and turns them into a stuck-point table and fixes.
---

# Blind playtesting (INTRANET ZERO)

Playtest a world the way a stranger meets it: no canon. You are the test runner; you may
read everything. The TEST SUBJECT (oracle, reference agent, or human) must not.

## 0. The canon wall

The subject never sees: `facts.yaml`, `proofs.yaml`, `gates.yaml`, `reports.yaml`,
`hints.yaml`, `beliefs.yaml`, `statements.yaml`, the master prompt's Appendix B/C, or the
world's author notes. The runner prepares a subject brief that contains only what a player
gets: the landing-page pitch, the desktop shell, and "file reports to advance".

## 1. Pass 1 — oracle agent (plumbing)

The oracle (packages/agent-runner, built in M2) is a scripted agent that plays the world
from a fixed action list with no model. It proves plumbing, not design:

- Nightly CI runs it over MCP; the gate is scorer `completed: true`.
- Run it locally against a dev server before any human session; a plumbing failure wastes
  the human's time.
- If the oracle cannot finish a world that the build says is solvable, file the failing step
  as a blocker — it is a world or server bug, not a design finding.

## 2. Pass 2 — reference agent, no hints

The reference agent is the LLM loop in packages/agent-runner (M2), configured by
`AGENT_BASE_URL`, `AGENT_API_KEY`, `AGENT_MODEL` (works with local model servers). Run it
on a fresh team session:

1. First run: no `iz_request_hint` calls at all.
2. Second run (after fixing anything pass 1 found): hints allowed, in tier order.

Capture per run:

- **Scorer JSON** (packages/agent-runner reads the team's event log; no LLM grading):

```json
{
  "world": "tutorial@1.0.0", "agent": "label",
  "completed": true,
  "gatesSolved": 3, "gatesTotal": 3,
  "reportSlotsCorrect": 4, "reportSlotsTotal": 4,
  "requiredFactsEvidenced": 5, "requiredFactsTotal": 5,
  "unsupportedClaims": 1,
  "toolCalls": 57, "hintsUsed": 0, "wallSeconds": 412,
  "tokens": { "input": null, "output": null }
}
```

- **Event log** for the team (the `events` table, one row per runtime event). Grep for
  `GateSolved`, rejected `submitAnswer`/`submitReport`, `ArtifactViewed` (last things seen),
  `HintRequested`, and attempts per gate.

## 3. Stuck points

A stuck point is where progress stops: for a human, >5 minutes with no new evidence; for an
agent, >20 tool calls with no new artifact viewed or collected. Log every one:

```markdown
| # | Gate (or "none") | Minutes / tool calls | Last artifacts viewed | Symptom | Hypothesis | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | g.mailbox | 14 min / 31 calls | a.m-vet-1, a.m-vet-2 | filed wrong choice twice | "two facts combined" phrasing ambiguous | rewrite slot label |
| 2 | g.printer | 6 min / 12 calls | etc/motd | tried "biscuit 2009" | hint never says no spaces | tier 3 says "nothing between them" |
```

Cross-reference: a stuck point with no tier-1 hint pointing at the relevant host is a
fairness failure (story-consistency-audit §6). A stuck point where the evidence exists but
is unfindable is a world bug; where it exists and is found but the check rejects the right
idea, it is a wording bug.

## 4. Pass 3 — human playtest

Use the script in `references/human-playtest-script.md`. Summary of the rules:

- 30–45 minutes, one world, think-aloud, observer silent except the scripted prompts.
- The human gets the game and nothing else. No docs, no spoilers, no hints unless they ask
  (record the tier cost as if scored).
- Observe: first action, where they look for answers, what they collect, when they stall.
- Debrief with the same questions every time (in the script).

## 5. Summarize and close the loop

End every playtest cycle with:

1. Scorer JSON per run (agent runs; human runs get minutes + hints used instead of tool calls).
2. The stuck-point table (§3).
3. A fix list in world terms: "rewrite hint g.printer tier 2", "add corroborating mail for
   f.year", "rename slot s.clue-kind label". Route fixes through the world-authoring skill,
   then re-run the build, then story-consistency-audit, then the SAME playtest pass again.
4. Anything the scorer cannot see (confusion, fun, pacing) goes in a short prose note — do
   not invent numbers for it.

When to run all this: before each content merge (with story-consistency-audit), after any
gate/proof/hint change, and before every milestone gate (M1: tutorial; M2: tutorial via MCP
plus human blind playtest by the project owner).
