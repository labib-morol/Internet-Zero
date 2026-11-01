# HANDOFF — INTRANET ZERO

Owner directive (2026-11-02, overnight autonomous run): M0 tasks in order, then M1, then
M2 engine parts. No pushes, no PRs. Commit locally after every green task. Decisions are
owner-final (docs/DECISIONS.md). No NODE_17 content ever.

## Current state

- M0 COMPLETE (gate passed 2026-11-02, commits through dd76258). See the
  docs/STATUS.md ledger for evidence.
- M1 in progress: view models end to end (bundle forge/mail sections,
  ServiceModule.view/collectibles, GET /api/view, leak sweep) — 25 root
  integration tests. apps/web scaffolded; Playwright harness configured with
  the system Edge channel. WorldSummary serves hosts (D20).
- A background agent is building the web foundation (packages/ui kit, desktop
  shell, in-game browser, landing) — it added two narrow pnpm
  minimumReleaseAgeExclude entries for the pinned @tanstack packages
  (integrator-reviewed, see DECISIONS).
- Next: integrate foundation → service-UI agents → Playwright e2e (M1 gate) →
  M2 engine parts (MCP server, tools, scorer, benchmark vs tutorial).

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
