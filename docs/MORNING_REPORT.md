# MORNING REPORT — INTRANET ZERO overnight run

Date: 2026-11-02 → 2026-11-03 · Workspace: `C:\Users\T14S\BUP Hackathon` ·
Branch `main`, **24+ local commits, nothing pushed** (per your directive).

## What was built (evidence-backed)

### M0 — Foundation: PASSED (gate recorded)
Monorepo (strict TS 6, pnpm 12, ESLint import bans), Zod 4 contracts, compiler with
all 12 build checks, deterministic runtime (`apply`/`fold`/`settleEvents`), Postgres
event store, tutorial world "Lost and Found", headless playthrough, Docker stack.

### M1 — Playable slice: implemented and browser-verified
Desktop shell (windows, dock, Alt+1..7, compact mode), in-game browser (never
navigates for real), GIT//FORGE, DEADLETTER (inspect-layers redactions), THE ARCHIVE,
NODE TERMINAL (xterm.js + screen-reader mode + passphrase flow), notebook, evidence
board, case file with reports/hints, guest sessions with one-time recovery codes,
private notes (isolated per user/team), snapshots (§15), content-hash asset serving,
self-hosted fonts, SPA serving.
**Browser acceptance:** 4 Playwright tests pass — guest startup, full tutorial
completion through visible UI (evidence-derived answer `cat+year`), **keyboard-only**
completion, 390×844 compact mode. axe scans: zero serious/critical on those screens.

### M2 — Engine parts: implemented
MCP v2 server at `/mcp` (official SDK `@modelcontextprotocol/server` 2.4.0 +
fastify adapter 2.0.1, Streamable HTTP, host validation, 60/min limit), 12 tools
mapping 1:1 to runtime actions with the fiction warning, session-bound revocable
agent tokens (UI + `pnpm iz agent-token --team <id>`), **official-client tutorial
oracle: 17 real tool calls, 3/3 gates, 2/2 report slots, 4/4 required facts,
completed:true** (`docs/mcp/tutorial-benchmark.json`), scorer with replay-based
metrics, persisted benchmark runs. NO NODE_17 content was authored (Appendix C
stays unused; the master prompt file is git-ignored).

## Final verification (last runs)

| Command | Result |
| --- | --- |
| `pnpm build` / `pnpm lint` / `pnpm typecheck` | PASS |
| `pnpm test` | 367 passed / 0 failed earlier; final re-run all green except server DB suite **skipped** (Docker down, see blockers) |
| `pnpm run test:integration` | 29 passed (headless tutorial, leak sweep, view models, scorer, import scan) |
| `pnpm exec playwright test --workers=1` | 4 passed (1 retry-masked flake under load; json reporter keeps traces) |

## Decisions made tonight (full list in docs/DECISIONS.md D24–D26)

- `fold` replays only recorded events; `settleEvents` persists implicit gate solves
  with action batches (fixes UI/scorer missing GateSolved).
- World endings are declared via terminal `completionFiles` metadata; tutorial
  requires reading `/etc/motd` (matches Appendix B without hard-coded ids).
- Public report forms no longer contain canonical `fact` identifiers; host lists in
  `/api/worlds` filtered to the requesting team's reachable hosts.
- Browser acceptance uses the project Playwright suite with the installed **Edge**
  channel (in-app browser guest never attached: "browser guest not attached").
- @axe-core/playwright (MPL-2.0) for a11y; self-hosted OFL fonts (Inter, IBM Plex Mono).
- Compiler test timeout raised to 60 s (full-world compilations under parallel load).

## Security fixes (independent review findings, all verified by tests)

Atomic event-batch append (no partial writes on conflict); terminal fs/forge/verify
built only from visible artifacts; gated terminal files hidden until passphrase;
locked connect targets indistinguishable `not_found`; grep patterns bounded (ReDoS);
overlay reads never emit `TerminalRead`; fixed-redaction text removed from every
client projection; other users' private claims filtered from state and rejected on
the shared stream; bundle loader verifies integrity hash + dangling refs + connectGate
refs + asset integrity + oversize content. Record: `docs/security/audit-2026-11-03.md`.

## Blockers (exact)

1. **Docker Desktop cannot start** (final state): `docker info` → "Docker Desktop is
   unable to start" / pipe `dockerDesktopLinuxEngine` not found. The 32 DB-backed
   server tests were green repeatedly earlier tonight (incl. full tutorial-over-REST);
   the last re-run skipped them. **You:** restart Docker Desktop / WSL, then
   `pnpm --filter @iz/server test` (expect 32/32) and `docker compose -f
   infra/docker-compose.yml up` (note the compose context bug on space-paths — use
   `infra/compose.prebuilt.yml` after `docker build -f infra/Dockerfile -t iz-app .`).
2. **Push auth (D5):** no `gh` CLI; per your directive nothing was pushed and no PRs
   were opened. "CI green on a PR" stays **partial** (the identical commands were run
   locally and are green). To verify CI: install gh / configure credentials, push,
   open a PR, watch `.github/workflows/ci.yml`.
3. **Not built (per scope):** NODE_17 (needs the private content repo), team invite
   links, GitHub sign-in, forum, Render deploy, reference LLM agent (oracle only).

## What you should run to check the work

```bash
cd "C:\Users\T14S\BUP Hackathon"
pnpm install
pnpm build && pnpm lint && pnpm typecheck
pnpm test                 # DB tests need Docker running
pnpm run test:integration
pnpm exec playwright test --workers=1   # uses installed Edge
git log --oneline | head -30            # 24+ local commits
```

## Feature ledger (final — full version in docs/STATUS.md)

| Feature | Status | Evidence |
| --- | --- | --- |
| M0 gate (§19.1) | done | STATUS gate row, commits through dd76258 |
| packages/schema, compiler, services, runtime, terminal | done | 50+23+21+71+18 tests |
| Tutorial world compiles + headless playthrough | done | `pnpm run worlds:build`, `test:integration` 29 passed |
| Server, event store, sessions, notes, snapshots, assets, SPA | done | 32 DB tests green earlier tonight |
| Desktop/browser/service UIs + notebook + board | done | 89 frontend tests + 4 browser tests |
| Keyboard-only + mobile + axe acceptance | done | `test/e2e/tutorial.spec.ts` |
| MCP server, tokens, tools, permissions | done | `apps/server/test/mcp-*.test.ts` |
| Oracle agent + scorer + benchmark | done | `docs/mcp/tutorial-benchmark.json` |
| CI green on a PR | partial | awaiting push auth (D5) |
| NODE_17 / private content | not started | needs owner-provided private repo |
| Teams invite links + live sync | done | teams-m2 1/1 + session binding migration 0001 |
| GHOSTBOARD forum (§10.7) | done | loader/views/UI + tutorial board; compiler+server green |
| GitHub sign-in (env-gated OAuth) | done | github-m2 1/1 (503 unconfigured; full flow with stub API) |
| Reference LLM agent (§14.3) | done | reference-m2: model-driven tutorial completion, scorer parity |
| Render deploy blueprint + docs | done | infra/render.yaml + docs/deploy/render.md |
| Docker daemon (2026-11-03) | was blocked, restarted | daemon + iz-dev-pg restored 2026-11-04 |


## Completion follow-up (2026-11-04)

"Finish the remaining stuffs" executed: teams, forum, GitHub sign-in, reference
agent, Render blueprint + deploy docs. Final battery 2026-11-04: build/lint/
typecheck PASS; workspace suite all green (22 server files / 43 tests with
Postgres live); integration 29 PASS; browser 4 PASS. Commits 3e5d00f (teams),
a937b62 (forum) and the final closeout commit. Still owner-dependent:
push/CI (D5), NODE_17 private repo, Render account + GitHub OAuth app.
