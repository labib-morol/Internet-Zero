# HANDOFF — INTRANET ZERO

Owner directive (2026-11-02, overnight autonomous run): M0 tasks in order, then M1, then
M2 engine parts. No pushes, no PRs. Commit locally after every green task. Decisions are
owner-final (docs/DECISIONS.md). No NODE_17 content ever.

## Current state

- M0 tasks 1–2 done: toolchain (pnpm 12.16.1, Node 24.15.0 approved deviation, Docker
  daemon running) and monorepo scaffold (10 stub projects, strict TS 6.0.3, ESLint 10
  with game-logic import bans, Vitest 5, Prettier). `pnpm build`, `pnpm test` (10/10),
  `pnpm lint` all green. Committed locally.
- Next step: M0 task 3 (install §4.1 third-party skills into `.agents/skills/`, write
  THIRD_PARTY_NOTICES.md), then task 4 (packages/schema — lead engineer personally).

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
