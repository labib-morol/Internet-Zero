# HANDOFF — INTRANET ZERO

Owner directive (2026-11-02, overnight autonomous run): M0 tasks in order, then M1, then
M2 engine parts. No pushes, no PRs. Commit locally after every green task. Decisions are
owner-final (docs/DECISIONS.md). No NODE_17 content ever.

## Current state

- M0 gate passed earlier (recorded in STATUS, commit dd76258).
- M1 UI code is integrated (commit cf52d80): desktop shell, browser, forge/mail/archive UIs, terminal, report/hint panel, notebook and evidence board. Browser acceptance has NOT been verified.
- Fresh checkpoint: build and lint pass; 289 workspace tests pass, 25 server tests skip; 27 root integration tests pass; frontend suite 88/88 passes. Docker daemon is unavailable now (Docker Desktop Linux-engine pipe not found), so Postgres-dependent tests cannot be reverified.
- M2: scorer is implemented and has two root tests; MCP package is still a scaffold. No oracle or benchmark run is complete.
- Exact next step: restore Docker availability, re-run all 25 server tests, then write and run the browser tutorial Playwright test plus mobile, keyboard and axe checks. Fix the UI-kit table nesting warning and review terminal canvas behavior in the real browser. Do not call M1 complete before these acceptance gates pass.
- After M1 acceptance: implement the requested M2 engine-only parts. No NODE_17 content; no push or PR.
- Local history: 23 commits; pnpm-lock.yaml is modified. No MORNING_REPORT has been written yet.

## Verify

```
cd "C:/Users/T14S/BUP Hackathon"
pnpm install
pnpm build && pnpm test && pnpm lint
```

## Blockers

- None blocking M0. Push/CI verification awaits owner auth (D5) — CI file will be
  verified by running identical commands locally instead.

## Notes for a fresh session

- Read docs/STATUS.md (ledger + environment) and docs/PLAN.md (M0 task table) first.
- The two .md files in the repo root are PRIVATE (git-ignored): the master prompt
  contains the NODE_17 answer key (Appendix C) — never commit, never log, never quote
  into code. Never implement anything from the second file (product spec) that is not in
  the master prompt.
- Never run player input on the host. In-game terminal is simulated (packages/terminal).
- Game logic only in packages/runtime; apps/server is transport-only. ESLint enforces
  the import bans for packages/{runtime,services,terminal,mcp}.
- Commits: verify `git check-ignore` on the private docs first; add explicit paths.

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
