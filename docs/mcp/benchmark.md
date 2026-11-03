# Benchmark policy (master prompt §14.3)

## What counts

- The only scorer is `scoreRun` in `packages/agent-runner/src/scorer.ts`. It reads a
  team's event log and emits the §14.3 JSON. No LLM grading anywhere.
- Public worlds (the tutorial, future public samples) are **practice**. Official scores
  run on held-out private worlds (M3) that have never been public.
- Never publish a leaderboard number that was not produced by this scorer on a
  held-out world. Agent runs on public worlds may be published only with the scorer
  JSON attached.
- `tokens` is `{ input: null, output: null }` unless the runner reports real counts.
- `requiredFactsEvidenced` counts required canon facts with at least one collected
  direct-proof artifact; `unsupportedClaims` counts claims without a `supports` link
  from evidence.

## How to run the tutorial oracle

Prerequisites: Postgres running (`docker start iz-dev-pg`), world compiled
(`pnpm run worlds:build`), server on :8080 (`pnpm run dev` or the compose stack).

```bash
pnpm exec tsx tools/benchmark.ts
```

The script creates a guest session, mints an agent token, drives the tutorial through
**real MCP tool calls** via the official client (`@modelcontextprotocol/client`), saves
the run through `POST /api/benchmarks`, and writes the scorer JSON to
`docs/mcp/tutorial-benchmark.json`. The saved run from 2026-11-03: 17 tool calls,
3/3 gates, 2/2 report slots, 4/4 required facts evidenced, `completed: true`.

An unattended variant lives in CI style as a test:
`apps/server/test/oracle-m2.test.ts` (oracle over a real server + Postgres, scorer
parity asserted).

## Report shape

See `packages/agent-runner/src/scorer.ts` (`ScoreReport`): `world`, `agent`,
`completed`, `gatesSolved`/`gatesTotal`, `reportSlotsCorrect`/`reportSlotsTotal`,
`requiredFactsEvidenced`/`requiredFactsTotal`, `unsupportedClaims`, `toolCalls`,
`hintsUsed`, `wallSeconds`, `tokens`.
