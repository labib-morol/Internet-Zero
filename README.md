# INTRANET ZERO

The internet is your crime scene. An open-source engine and hosted browser game for
investigating fictional internet worlds: browse a dead company's leftover services, collect
evidence, link it into claims, and file case reports that are graded against a canonical truth.

## Quick start

Prerequisites: Node 24 (engines `>=22`), pnpm 12, Docker (for Postgres).

```bash
pnpm install
cp .env.example .env                                       # FIRST: set SESSION_SECRET (compose refuses to start without it)
docker compose -f infra/docker-compose.yml up -d          # Postgres 18 + app on :8080
pnpm run worlds:build                                      # compile the tutorial
pnpm run dev                                               # API :8080 + web :5173 (host dev needs a reachable Postgres)
```

Host-based `pnpm run dev` needs Postgres on localhost:5432 — publish the port or run a
throwaway instance: `docker run -d --name iz-dev-pg -e POSTGRES_USER=intranet -e
POSTGRES_PASSWORD=intranet -p 5432:5432 postgres:18-alpine`. The compose stack above is
the self-contained alternative (no published DB port; the app container talks to `db`).

Open http://localhost:5173 and press **Open the case** — a guest session starts the
public tutorial "Lost and Found" (CC BY 4.0), playable in the browser, keyboard-only
and over MCP.

## Tests

```bash
pnpm build && pnpm lint && pnpm typecheck
pnpm test                 # unit + integration (Postgres tests need Docker)
pnpm run test:integration # headless tutorial playthrough, leak suite, scorer
pnpm exec playwright test --workers=1   # real-browser tutorial + axe
```

## Agents (MCP)

The same worlds are playable over MCP with exactly a player's permissions:
create a token in the Help window (or `pnpm iz agent-token --team <id>`), then
connect a Streamable-HTTP client to `<origin>/mcp`. See `docs/mcp/connect.md` and
run the scripted tutorial oracle with `pnpm exec tsx tools/benchmark.ts`
(scorer JSON lands in `docs/mcp/tutorial-benchmark.json`; policy in
`docs/mcp/benchmark.md`).

## Status

M0 and M1 are complete for the public tutorial. M2 (teams with invite links, forum,
GitHub sign-in backend, MCP server, agent tokens, oracle, scorer, benchmark runs) is
implemented; production-readiness hardening (required-DB CI, logout/revocation,
team-binding fixes, readiness 503, origin/CSRF gate, proxy-aware rate limiting) landed
2026-11-09 — see `docs/security/audit-2026-11-09.md`. Tutorial-first public beta is the
release target. Details and evidence: `docs/STATUS.md` (ledger), `docs/PLAN.md`,
`docs/release/RELEASE_REPORT.md`.

Engine Apache-2.0 · sample worlds CC BY 4.0
