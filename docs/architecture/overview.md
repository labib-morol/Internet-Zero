# Architecture overview

INTRANET ZERO is a fictional-internet investigation engine: players browse a simulated
web inside a desktop shell, collect evidence, and file case reports that the engine
grades against a canonical, human-authored truth. This document describes how the
pieces fit; frozen interface details live in `packages/schema/src`.

## One server, one browser app

- `apps/web` — Vite + React SPA: landing page, desktop shell, service UIs, notebook,
  evidence board. No game logic.
- `apps/server` — one Fastify process: REST, WebSocket (team event streams), MCP
  (M2), and the built SPA. Transport only: it authenticates, loads state, calls the
  runtime, persists events, builds view models, broadcasts.

## Packages (dependency direction: schema ← everything; runtime ← server/mcp; services ← compiler)

| Package | Owns |
| --- | --- |
| `packages/schema` | Zod 4 schemas: world source, compiled bundle, actions, events, view models, REST/WS/MCP contracts; shared answer normalizer. Single source of truth; JSON Schema is exported from it. |
| `packages/compiler` | `iz` CLI: YAML world sources → validated JSON bundle. 12 build checks, safe-Markdown→AST, salted answer hashing, content-addressed assets, `report.json`. |
| `packages/services` | Service loaders (forge, mail, archive, terminal) that turn world sources into artifacts. `view()`/`collectibles()` arrive with the M1 UI. |
| `packages/runtime` | The deterministic reducer: `apply`/`fold`/`initialState`, conditions, gates, evidence/claims/links, hints, rate limits, world events. Imports nothing that does I/O (ESLint-enforced). |
| `packages/terminal` | Simulated command interpreter over the world's virtual filesystem (M1). |
| `packages/ui`, `apps/web` | Desktop shell and service UIs (M1). |
| `packages/mcp`, `packages/agent-runner` | MCP tools over the same runtime actions; reference agent and scorer (M2). |

## Data flow

1. **Build time.** `iz build worlds/<id>` compiles YAML sources + Markdown into a
   `WorldBundle`: artifacts with safe ASTs, gates whose plaintext answers are replaced
   by salted hashes (`sha256(salt:gateId:normalized)`), and a server-only `canon`
   section (facts, beliefs, statements, proofs). Twelve build checks must pass.
2. **Play time.** Every mutation is an `Action` sent by a player or agent. The server
   folds the team's event log into a `RuntimeState`, calls `runtime.apply`, appends
   the returned `GameEvent`s to the team stream (`UNIQUE(team_id, seq)`), broadcasts
   them, and projects the result into view models. Visibility is enforced before any
   content leaves the server: locked artifacts, canon and answer hashes never appear
   in any response.
3. **Multiplayer.** Each team has one ordered event stream; WebSocket clients replay
   from `lastSeq` on reconnect. Solo players are a team of one.
4. **Scoring.** Score = solved gate scores − hint costs. The scorer (M2) reads event
   logs; there is no LLM grading anywhere.

## Determinism

The runtime never reads the wall clock or randomness: time comes from an injected
`Clock`, ids are derived from `(teamId, sequence, content)`, and `fold(events)` always
reproduces the state `apply` produced — enforced by property tests.

## Security stance (details in docs/security/threat-model.md)

No player input is ever executed on the host; the terminal is a simulated interpreter.
Game-logic packages ban `child_process`, `vm`, `eval`, `Function`, `fs` and network
modules at lint time. Fictional hosts resolve only through the in-game router.

## Milestones

M0 foundation (schema, compiler, runtime, event store, tutorial world, CI) →
M1 playable slice (desktop shell, five services, notebook/board, guest sessions) →
M2 platform (MCP + agents, teams live sync, forum, deploy). See `docs/PLAN.md`.
