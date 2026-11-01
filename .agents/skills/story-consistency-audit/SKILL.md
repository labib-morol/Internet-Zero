---
name: story-consistency-audit
description: Use before merging world content: checks canon contradictions, unprovable facts, lies without counter-evidence, unfair puzzles, and gate graph problems. Runs iz build --report and reads the reachability tree for INTRANET ZERO worlds.
---

# Story consistency audit (INTRANET ZERO worlds)

Run this before every content merge and after any edit to `facts.yaml`, `proofs.yaml`,
`gates.yaml`, `reports.yaml`, `statements.yaml`, `beliefs.yaml`, `hints.yaml` or service
content. Pair it with the blind-playtesting skill. Do not edit code here; you are auditing
world canon.

## 1. Produce the report

```bash
pnpm iz build worlds/<id> --out dist/worlds --salt 0123456789abcdef0123456789abcdef --report dist/worlds/report-<id>.json
```

The build must exit 0. `report.json` has three parts: `counts` (artifacts, gates, assets),
the `reachability tree`, and `warnings`. An empty warnings list is the bar — a warning like
"host X has no artifacts" or a possible double-delivery note is a finding even when the
build passes.

## 2. Read the reachability tree

`tree.steps` is the ordered walk of a simulated player who solves every gate: entries are
`{kind: host|gate|artifact|event, id, reason}`. Check:

- [ ] Every gate id appears in `tree.solvedGates` (the compiler fails check 7 otherwise, but
      read the ORDER — see step 3).
- [ ] `reachableHosts` matches design intent; no host is reachable earlier than intended.
- [ ] `reachableArtifacts` does not include anything that should stay locked behind a late gate.
- [ ] The entry step resolves to the repo/document you meant players to open first.

## 3. Proofs reachable BEFORE the gate that needs them

For each required fact (`facts.yaml`, `required: true`):

1. List its proofs from `proofs.yaml` (expect one `direct` + one `corroborating` in a
   different service).
2. For each proof artifact, find its position in `tree.steps` (it appears when its host
   unlocks or an event reveals it).
3. Find the first gate whose `requires` or check depends on the fact (report slots, answer
   gates, evidence sets, or `factEstablished` conditions).
4. The proof artifact step must come BEFORE that gate step. If a proof sits on a host
   unlocked by the gate itself, the puzzle is unsolvable in practice — blocker.

Record per fact: `f.year — direct a.1692bb4c... (forge, step 4) + corroborating a.m-hint
(mail, step 6) → needed by g.mailbox (step 7). OK`.

## 4. Lies have findable counter-evidence

The compiler enforces existence and reachability (check 5). Audit findability:

- [ ] For every `lies_about` / `believes_false` belief and every `truthful: false` statement,
      name the contradicting artifact(s).
- [ ] The contradiction is discoverable through normal play (searchable text, listed folder,
      mail thread) — not behind a pixel hunt, an unindexed terminal path, or a fixed redaction.
- [ ] The contradiction lives in a DIFFERENT service than the lie, so one host can't hide both.
- [ ] Lie + counter-evidence are both referenced in the findings table.

## 5. Canon contradictions

Check 3 fails hard contradictions (same subject+predicate, different objects, overlapping
validity). Also scan near-misses the compiler accepts:

- Same proposition expressed with different predicates (`rotatedPrinterAdminPass` vs
  `changedPrinterPass`) — pick one predicate vocabulary for the world.
- `validFrom`/`validTo` windows that accidentally make two facts simultaneously true.
- Beliefs that contradict each other without an authored lie (a `suspects` that the story
  never resolves).

## 6. Puzzle fairness checklist

- [ ] No outside knowledge needed beyond common sense (no real companies, history, codebases).
- [ ] No pixel hunts: every clue is in searchable text or an explicitly listed artifact.
- [ ] No single point of failure: every gate answer and report slot has a direct proof AND a
      corroborating proof in different services.
- [ ] Answers derivable from in-world evidence alone; normalizers in the gate match how the
      answer is written in the hint and evidence (case, punctuation, date format).
- [ ] Every step has a hint path: three tiers exist (check 9) and tier 1 points somewhere real.
- [ ] No gate requires itself directly or transitively; no dead-end gates that unlock nothing
      and matter to nothing (they pad the score).
- [ ] Rate-limit friendly: a wrong-but-reasonable guess (e.g. `Biscuit2009` vs `biscuit2009`)
      normalizes to the accepted answer, or is clearly hinted.
- [ ] The entry point teaches the first verb (the tutorial's entry is the repo README).

## 7. Findings table

Report findings in this exact shape (paste into the merge request / final message):

```markdown
## Story consistency audit — <world id> — <date>

Build: exit 0, warnings: 0. Command: pnpm iz build worlds/<id> ...

| # | Severity | Where (file:id) | Finding | Fix |
| --- | --- | --- | --- | --- |
| 1 | blocker | gates.yaml:g.printer | direct proof unlocks after gate | move proof to forge host |
| 2 | major | statements.yaml | lie countered only on same service | add archive counter-evidence |
| 3 | minor | hints.yaml:g.toner | tier 1 names the answer | rewrite as location nudge |
| 4 | note | report.json | host printer has no collectibles | intentional |

Severity: blocker (merge denied) / major (fix before merge) / minor (fix in follow-up) / note.

Sign-off: [ ] all blockers and majors fixed, rebuild clean, re-audit passed.
```

After fixes: rerun §1 and re-verify the changed rows. A merge requires zero blockers, zero
majors, zero warnings.
