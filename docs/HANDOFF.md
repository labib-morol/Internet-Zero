# HANDOFF — INTRANET ZERO

Owner directive (2026-11-02, overnight autonomous run): M0 tasks in order, then M1, then
M2 engine parts. No pushes, no PRs. Commit locally after every green task. Decisions are
owner-final (docs/DECISIONS.md). No NODE_17 content ever.

## Current state

- M0 tasks 1–4 done and committed (toolchain, scaffold, skills, schema).
- M0 T5–T8 done and committed (780aa11): compiler (iz CLI, 12 checks, safe AST,
  hashing), services loaders, runtime (apply/fold/initialState, gates, rate
  limits, events, deterministic ids, property tests). Root: 152 tests green.
- In progress on background agents: tutorial world content (worlds/tutorial),
  server skeleton (apps/server). Infra (Dockerfile/compose/CI) written by the
  lead engineer; image build validating in background.
- Next steps: integrate tutorial (compile + headless playthrough test), server
  integration against iz-dev-pg, compose up, M0 gate, then M1.
- Project skills (§20 six files) and THIRD_PARTY notices: third-party skills
  done; the six project skills were lost to a subagent concurrency limit and
  will be retried or written by the lead engineer.

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
