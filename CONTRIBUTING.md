# Contributing to INTRANET ZERO

Thanks for your interest. The engine is Apache-2.0; public sample worlds are CC BY 4.0.

## Ground rules

- Read `AGENTS.md` and `docs/STATUS.md` before your first change.
- TypeScript strict, pnpm workspaces, Node 24 (engines `>=22`).
- Game logic lives only in `packages/runtime`; `apps/server` is transport only.
- Never execute player input on the host; the in-game terminal is simulated.
- Every change: `pnpm build && pnpm test && pnpm lint` must pass, and
  `docs/STATUS.md`'s feature ledger updated when you finish a feature.

## Workflow

1. Fork/branch from `main`.
2. Small commits with clear messages; tests first for runtime and compiler changes.
3. Open a pull request; CI runs lint, typecheck, build, world compile, unit and
   integration tests (Postgres service), and a secret scan.

## World content

- Author worlds per `worlds/tutorial` and the `world-authoring` skill
  (`.agents/skills/world-authoring/SKILL.md`).
- Public worlds are CC BY 4.0. Campaign content belongs in the separate private
  content repository — never in this one.

## Reporting issues

Security issues: see `SECURITY.md`. Everything else: GitHub Issues with a minimal
reproduction (world source or test that fails).
