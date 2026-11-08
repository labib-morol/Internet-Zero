# HANDOFF — INTRANET ZERO

Owner directive (2026-11-02, overnight autonomous run): M0 tasks in order, then M1, then
M2 engine parts. No pushes, no PRs. Commit locally after every green task. Decisions are
owner-final (docs/DECISIONS.md). No NODE_17 content ever.

## Current state (updated 2026-11-09)

M0, M1 and the M2 engine parts are implemented and accepted; the details of earlier
checkpoints live in docs/STATUS.md (the ledger is authoritative — the historical text
below and in MORNING_REPORT.md describe superseded states, not open work). Current
release work: a tutorial-first public beta, tracked in
docs/superpowers/plans/2026-11-09-production-readiness.md with a running execution
ledger at docs/release/EXECUTION_LEDGER.md and the owner checklist at
docs/release/MANUAL_LAUNCH.md.

Fresh-verification commands:

```
cd "C:/Users/T14S/BUP Hackathon"
pnpm install
pnpm build && pnpm test && pnpm lint        # DB-backed server tests REQUIRE Postgres
pnpm run test:integration
pnpm exec playwright test --workers=1       # browser tutorial + axe (chromium in CI)
```

## Notes for a fresh session

- Read docs/STATUS.md (ledger + environment) and docs/release/RELEASE_REPORT.md first.
- The two .md files in the repo root are PRIVATE (git-ignored): the master prompt
  contains the NODE_17 answer key (Appendix C) — never commit, never log, never quote
  into code. Never implement anything from the second file (product spec) that is not in
  the master prompt.
- Never run player input on the host. In-game terminal is simulated (packages/terminal).
- Game logic only in packages/runtime; apps/server is transport-only. ESLint enforces
  the import bans for packages/{runtime,services,terminal,mcp}.
- Commits: verify `git check-ignore` on the private docs first; add explicit paths.
- `@iz/ui` and workspace packages resolve via dist: after editing a package's src,
  rebuild it before web tests/e2e see the change.

## Continuation handoff
Main owns all paths now (subagents stopped after provider token-rate-limit interruptions).
Gate events now persist, not synthetic in fold. 363 workspace tests +29 root tests +3 real
browser tests pass. Notes/snapshots/assets/SPA implemented. Exact next: M2 tool factory,
Fastify /mcp bearer agent-token auth, oracle runner + benchmark integration; then full
security/review gate and MORNING_REPORT. Never push. `.env` and master prompt ignored.

## Continuation handoff (2026-11-03 morning)

Everything is committed locally through the M1/M2 engine checkpoint. Main owns all
paths; the two GLM-5.3 verification/docs subagents failed with provider
"Model request failed", so docs and audit were written inline (files listed in
MORNING_REPORT.md). Exact next steps: (1) fix Docker Desktop startup, run
`pnpm --filter @iz/server test` to re-verify the 32 DB tests; (2) set up push auth
and turn CI-on-PR from partial to verified; (3) read MORNING_REPORT.md. Never push
without the owner. `.env` and the master prompt remain git-ignored (verify with
`git check-ignore` before any commit).
