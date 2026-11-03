# INTRANET ZERO

The internet is your crime scene. An open-source engine and hosted browser game for
investigating fictional internet worlds: browse a dead company's leftover services, collect
evidence, link it into claims, and file case reports that are graded against a canonical truth.

## Quick start

Prerequisites: Node 24 (engines `>=22`), pnpm 12, Docker (for Postgres).

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d          # Postgres 18
cp .env.example .env                                       # then set SESSION_SECRET
pnpm run worlds:build                                      # compile the tutorial
pnpm run dev                                               # API :8080 + web :5173
```

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

M0 and M1 are complete for the public tutorial; M2 engine parts (MCP server, agent
tokens, oracle, scorer, benchmark runs) are implemented. Not built yet: team invite
links, GitHub sign-in, forum, Render deploy. Details and evidence:
`docs/STATUS.md` (ledger), `docs/PLAN.md`, `docs/security/audit-2026-11-03.md`.

Engine Apache-2.0 · sample worlds CC BY 4.0
