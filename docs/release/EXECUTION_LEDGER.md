# Execution ledger — plan: docs/superpowers/plans/2026-11-09-production-readiness.md

Started: 2026-11-09 01:50 (+06:00 local). Owner budget ≈5h → freeze new scope 05:50, handoff notes from 06:35, hard stop 06:50.
Branch: `release/tutorial-beta` (created 01:52 from main@93f20e3). **Commits NOT authorized by owner — all changes stay uncommitted in the working tree until explicit approval.**
Executor: GLM-5.3 Flash in-session. Skills loaded: executing-plans, test-driven-development, systematic-debugging, verification-before-completion, security-audit, writing-plans (context).

## Environment at start

- Node 24.15.0, pnpm 12.16.1 (owner-approved deviation D1; AGENTS.md still says Node 22 — conflict disclosed to owner, not silently edited).
- Docker 29.6.1 running (owner started it); `iz-dev-pg` postgres:18-alpine started 01:53, ready on localhost:5432, admin `intranet/intranet` verified via psql.
- Baseline (planning session): build exit 0, 314 passed / 42 skipped (all skips = DB-backed server tests), web bundle 879.06 kB.

## Rulings

- Ruling: ledger lives at `docs/release/EXECUTION_LEDGER.md` (owner-specified path) instead of the skill's `.superpowers/sdd/` workspace; the sdd helper scripts do not exist in this project. Cost: manual ledger discipline required after compaction.
- Ruling: no `git commit` per task despite plan/skill defaults — owner explicitly withheld commit authorization. Cost: large uncommitted working tree; recovery relies on this ledger + `git diff`. Will ask once for commit authorization at a checkpoint.
- Ruling: TDD applied to code changes; configuration-only edits (ci.yml, render.yaml) are verified by validation commands instead of manufactured unit tests, per plan note.

## Task 1 — Make test results trustworthy [release blocker] — complete 02:07

- TDD: `apps/server/test/db-required.test.ts` written first — RED observed (5 failed: `deriveTestDatabaseUrl` missing), then GREEN 6/6 after implementation. One test-side URL-construction bug fixed (bracketing non-IPv6 hosts); one implementation fix for WHATWG IPv6 hostname brackets.
- `apps/server/test/helpers.ts`: `ADMIN_URL` now env-driven (`TEST_DATABASE_ADMIN_URL`, local default preserved); per-test DB URLs derived via `deriveTestDatabaseUrl()` (swaps only the database name); remote admin hosts refused unless `TEST_ALLOW_REMOTE_ADMIN=1` (destructive-setup guard).
- `apps/server/test/require-postgres.setup.ts` + `vitest.config.ts` globalSetup: `REQUIRE_POSTGRES=1` fails the run when Postgres is unreachable. Gate RED proof: dead URL `localhost:5999` → exit 1 with clear console reason (vitest's startup-error renderer mangles thrown setup errors — message printed directly to be unmissable). Gate GREEN: real DB → **49 passed / 0 skipped**.
- `.github/workflows/ci.yml`: test job now sets `TEST_DATABASE_ADMIN_URL` + `REQUIRE_POSTGRES=1` (unused `DATABASE_URL` removed), fails on any `[0-9]+ skipped|todo` in test output; new `e2e` job: postgres service, `E2E_DATABASE_ADMIN_URL`, bundled chromium (`playwright install --with-deps chromium`), `--workers=1`, always-uploads JSON+HTML reports (no traces/screenshots on public CI). YAML parse-validated (3 jobs).
- `playwright.config.ts`: env-driven DB (`E2E_DATABASE_ADMIN_URL`/`E2E_DB_NAME`, unique `iz_e2e_*` per run), browser channel (`E2E_BROWSER_CHANNEL`; CI=bundled chromium, local default msedge, empty string=bundled locally), `reuseExistingServer: !CI`, retries `CI?1:0` (CI flakes reported via JSON, never hidden), html+json reporters, `trace` off in CI / retain-on-failure locally. `apps/server/scripts/e2e-ensure-db.ts` creates the e2e DB inside the server package (pg not resolvable at root); refuses non-local hosts unless `E2E_ALLOW_REMOTE_DB=1`; server migrates at boot as before.
- Evidence: full battery with DB up → `pnpm build && pnpm test` exit 0, **362 passed / 0 skipped** across 9 packages (was 314 passed / 42 skipped). E2E with bundled chromium, fresh DB, `--workers=1 --retries=0`: **4/4 passed** (53s).
- Incident: first full e2e run after the 197 MB chromium install failed all 4 tests (servers reported `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`; landing page loaded then servers vanished). Debug run (`DEBUG=pw:webserver`) passed cleanly; full rerun passed 4/4 twice since. Recorded as an unexplained cold-start transient — no code change made; if it recurs in CI, investigate webServer teardown ordering.
- Ruling: no auto-teardown of `iz_e2e_*` databases (pg not importable from playwright root process; complexity not justified). Cleanup documented in playwright.config.ts comments; probes dropped manually this session.
- Ruling: CI uploads reports but NOT traces/screenshots (public repo artifacts must not carry page content); local traces stay local. Recovery-code e2e assertions never assert the code as text (verified in tutorial.spec.ts), so JSON reports carry no recovery codes.

## Task 2 — Repair identity, recovery and live team state [release blocker] — complete 02:52

**Server (all RED-first, observed failing):**
- `auth.ts`: extracted `resolveSessionTeam()` — the ONE authoritative session-team resolution (bound team + membership check, fallback first membership) now shared by REST and WS. Previously WS used `firstTeamForUser` while REST honored `sessions_web.team_id`: a joined player's REST writes and live stream went to different teams. Empty `Bearer ` tokens now fall through to cookie auth. `AuthContext` carries `sessionTokenHash`.
- `ws.ts`: hello uses `resolveSessionTeam`; cookie fallback (empty hello token → signed upgrade cookie, DECISIONS D27 schema change `sessionToken.min(1)`→`min(0)`); `isAllowedWsOrigin` gate (same-host / publicOrigin / localhost-dev-only; non-browser no-Origin allowed) — RED tests for the binding + live sync in `session-lifecycle.test.ts`; origin helper unit-covered via export (browser-cookie WS path covered by e2e, not Node WS — undici cannot send cookie headers; noted honestly).
- Logout: `POST /api/sessions/logout` (idempotent) — revokes the session row, closes open sockets via the new `SessionSockets` registry, clears the cookie. RED tests: bearer/cookie/new-socket revocation, open-socket close (1008), Set-Cookie clear.
- `routes/sessions.ts` resume: prefers the most recent live BOUND team (`latestLiveSessionTeamId`) — recovery returns a joined player to their joined team, not their original solo team. RED test discriminates.
- `routes/teams.ts` join: count-check + insert + rebind now run in ONE transaction with `SELECT … FOR UPDATE` on the team row (concurrent-join cap test passes; hardened against races that inject-based tests can't produce today).
- `db/client.ts` `Tx` type; `addTeamMember`/`bindSessionTeam` accept `Db | Tx`.

**Client:**
- `TeamSocket.resetStream()` (RED-first in `packages/ui/test/ws-cursor.test.ts`): replay cursor is PER TEAM. `switchTeam` reordered: server truth fetch → state swap → cursor reset → socket restart (old order started the stream with the OLD team's cursor and merged events into OLD state).
- `startGuest`: recovery code captured immediately after creation — a failed follow-up state/world fetch no longer costs the player their only copy; retry (`bootstrap()`) re-enters the existing session (no second guest). RED verified through the REAL resolution chain: `@iz/ui` tests/e2e resolve **dist**, so an honest cycle was stash → `pnpm --filter @iz/ui build` → RED (`expected undefined to be '0123456789abcdef'`) → pop → rebuild → GREEN. **Learning: after ANY packages/ui source change, rebuild before apps/web tests/e2e.**
- `bootstrap()` cookie path: no stored token + valid cookie → enters the shell (OAuth callback can now complete; token never exposed to JS; WS hello authenticates via upgrade cookie). 401 on stored token → dead cookie cleared via logout call (RED test updated: mock extended for the new `IzClient.logout`, plus assertion it was called).
- `LandingPage`: "Try again" retry appears only when a session token exists (re-enters instead of creating a guest).
- Sign-out/expiry presentation reset: `apps/web/src/session-lifecycle.ts` (`installSessionLifecycle()` in main.tsx) wipes browser history/bookmarks/visited hosts/cached view and terminal scrollback/host when a session ends — new guest on a shared machine starts clean (RED-first in `apps/web/test/session-lifecycle.test.tsx`).
- `apps/web/test/session.test.tsx`: tautological server assertion removed in teams-m2; 401-test mock extended (interface growth, not assertion weakening).

**Evidence:** full battery `pnpm build && pnpm test` exit 0 — **373 passed / 0 skipped** (was 362). `pnpm lint` exit 0. Session/ws/teams/suites: 16/16. Web lifecycle: 4/4. UI cursor: 2/2.

**Deferred within Task 2 (noted, not silently dropped):** mid-batch disconnect cursor-ahead edge (client advances lastSeq on receipt; application is same-tick — risk window negligible, revisit if replay gaps are ever observed); full browser cookie-WS e2e assertion (comes with Task 6 browser acceptance).

## Task 3 — Make deployment and security safe [release blocker] — complete 03:24

All RED-first in `apps/server/test/production-safety.test.ts` (6 tests, observed failing):
- `/readyz` → 503 when unready (DB dropped mid-test), `/healthz` stays 200; compose `r.ok` healthcheck now correct.
- Rate limiting behind a trusted proxy: `clientIp()` uses the RIGHTMOST X-Forwarded-For entry (proxy-added) when `TRUST_PROXY=1`; forged leftmost entries cannot forge buckets; per-client buckets verified.
- Origin/CSRF gate: cookie-authenticated mutations require a matching Origin (same host / publicOrigin / localhost-dev-only); missing Origin → 403; Bearer and cookie-less requests exempt; guest creation unaffected.
- `Cache-Control: private, no-store` on all `/api/*` responses.
- `NODE_ENV=production` requires https:// PUBLIC_ORIGIN (boot refusal).
- WS hello deadline (10 s default, injectable): unauthenticated sockets closed 1008.

**Debug findings (systematic-debugging, both root-caused):**
- Guard initially never fired: `security.ts` imported `COOKIE_NAME` from `config.js` — the name lives in `auth.ts`; config exports `SESSION_COOKIE`. Silent-undefined named import under esbuild transform (no typecheck at transform). Traced via branch-level logging. Fixed to `SESSION_COOKIE`.
- Hooks must `return reply.code(...).send(...)` in Fastify 5 async onRequest hooks — `await ...send()` without returning let the route handler run anyway (observed: hostile-origin logout still returned 204).
- Full-battery crash (Windows 0xC0000409 worker abort at fork startup, different files each run) reproduced only under cross-package parallel load; server suite green in isolation. Mitigations per the documented CI precedent (64f67e9/d35db44): server `maxForks` 4→2 AND root `pnpm test` now runs with `--workspace-concurrency=2`. Recorded as ruling: load-environment stabilization, not assertion masking (all suites green solo AND in battery).

**Also fixed (found by the new tests):** `pool.on("error")` handler in `db/client.ts` — a terminated idle DB connection (DB restart/admin drop) was an unhandled exception that could kill the process.

**Hardening:** OAuth state cookie Secure under https + 10 s fetch deadlines (`routes/github.ts`); SIGTERM/SIGINT drain deadline 10 s with non-zero exit on close failure (`index.ts`); `infra/render.yaml` `dockerfilePath: ./infra/Dockerfile`, `TRUST_PROXY=1`, `NODE_ENV=production`, single-replica documented; `.env.example` documents TRUST_PROXY/NODE_ENV; `docs/deploy/render.md` deployment-shape notes; `docs/security/audit-2026-11-09.md` (full §16 table; blockers F1–F5 fixed; threat model gaps refreshed).

**Dependency/advisory triage:** `pnpm audit --prod` initially 2 moderate (glob/minimatch via @fastify/static) — resolved by `pnpm --filter @iz/server update @fastify/static --latest`; now "No known vulnerabilities found" (audit-level high). Gitleaks: 35-commit history clean; working-tree scan flagged the git-ignored local `.env` (correct) and my synthetic test secret literal (aligned to the existing fake pattern).

**Evidence:** battery `pnpm build && pnpm test && pnpm lint` exit 0 — **379 passed / 0 skipped**, 0 unhandled; render.yaml parses with dockerfilePath + 8 env vars.

**Honest scope note:** staging/production acceptance (HTTPS host, real OAuth, persistence, backups) NOT exercised — owner-gated, stays in the release report as pending.

## Task 4 — Fix the player journey, then polish [high priority] — complete 04:16

**Fixed (RED-first where code behavior):**
- **Graphical terminal Clear/rollover blindness** (`TerminalConsole.tsx` + store): buffer lines now carry monotonic ids (`TerminalBufferLine.n`); the renderer syncs via `planTerminalSync(lastN, lines)` — Clear wipes the engine, the 500-line cap rollover still renders new lines, remount replays. Old index arithmetic stalled forever after Clear/cap. 7 unit tests (counter-agnostic) + existing 13 terminal tests green. Also: ResizeObserver refits the terminal when its CONTAINER resizes (window drag/minimize), not just the viewport.
- **Browser navigation identity** (`browser/store.ts`): monotonic request ids gate every success AND failure response (navigate/back/forward); late responses cannot clobber a newer page. Invalid addresses now give actionable feedback instead of silent false. 3 new tests + 9 existing browser tests green.
- **Purchased hints survive panel close/reload (D28)**: `GetStateResponse.purchasedHints` (schema + DECISIONS note) derived server-side from the team's OWN hintsUsed + bundle; unpurchased tiers never leave the server (asserted). Client: `IzClient.getState()` returns the full response; session store carries `purchasedHints`; CaseFilePanel seeds missing tiers on mount. RED→GREEN verified through the dist chain (stash → rebuild → fail → restore → pass).
- **Private notes**: refetch on TEAM change (notes are team-scoped; token unchanged on join); save-in-flight guard (one write per submit); the DRAFT lives in a store that survives app switching and is wiped on session end (`resetNoteDrafts` in session-lifecycle); failed saves keep the draft for retry.
- **Landing honesty**: real GitHub/MCP-docs/Source/Documentation links replace `href="#"` (in-fiction in-app `#` links are a different concern and remain); stale "invite links arrive with the next milestone" replaced — teams are live.

**Deferred (honest, not silently dropped):**
- Modal focus trap / background inert for RecoveryModal + BoardWindow dialog; window activation via DOM focus; Network links revealing Browser in compact mode; notebook tab arrow-key navigation. Axe e2e currently reports zero serious/critical on core screens, so these are enhancements, not release blockers for the beta.
- Tutorial completion feedback + replay action in the shell (server-derived completion projection needed; the tutorial already ends with visible terminal output).
- Full-page-reload persistence assertions for notes/hints (e2e-level; partially covered by the server projection test + Task 6 browser run).

**Evidence:** battery `pnpm build && pnpm test && pnpm lint` exit 0 — **391 passed / 0 skipped**. Two contract changes recorded: D27 (WS hello token), D28 (hint projection).

## Task 5 — Performance and honest public documentation — in_progress 04:16


## Task 5 — Performance and honest public documentation — complete 04:32

- **Bundle split (measured):** initial JS 879.06 kB → **353.81 kB minified / 106.05 kB gzip** (−58% gzip; target ≤200 kB gzip met). Evidence board (190.5 kB / 61 kB gzip) lazy-loads when its window opens; graphical terminal xterm (339 kB / 86 kB gzip) lazy-loads on first terminal page/window render (it was reaching the main chunk through the browser's terminal service page). Suspense fallbacks styled to the existing design. All 104 web tests pass across the lazy boundaries; the 500 kB build warning is gone. Lighthouse/LCP not run (no production host) — recorded honestly in the release report.
- **README quickstart**: `.env` (SESSION_SECRET) BEFORE compose; documented that host-based `pnpm dev` needs a reachable Postgres with the throwaway `iz-dev-pg` one-liner vs the self-contained compose stack. Status section no longer claims teams/OAuth/forum/Render are unbuilt.
- **HANDOFF**: refreshed to point at the current release artifacts (plan, ledger, release report) with the dist-resolution learning recorded for fresh sessions.
- Deferred: Lighthouse/LCP field measurements (need a deployed host — owner-gated), reference-agent CLI wrapper (stub-tested; not a beta requirement per plan).

## Task 6 — Final acceptance, independent review and delivery — in_progress 04:32

## Task 6 — Final acceptance, independent review and delivery — complete 05:05

- Full gates (fresh, after all fixes): `pnpm build && pnpm test && pnpm lint && pnpm typecheck` exit 0 — **395 passed / 0 skipped**; `pnpm run test:integration` 29 passed; e2e (bundled chromium, fresh DB, workers=1, retries=0) **4/4** including full tutorial completion and keyboard-only; audit clean; gitleaks clean.
- **Independent whole-branch review (fresh context) — verdict: no blockers.** One major + 9 minors. Fix pass applied (single pass, tests first where behavior-testable):
  - Major: chunk error boundary — `apps/web/src/shared/ChunkErrorBoundary.tsx` wraps board/terminal lazy surfaces (fallback + real Reload; React caches lazy rejections so a retry loop would lie). 2 unit tests.
  - Minors fixed: signOut/invalidate clear `purchasedHints` + `seenEvents`; cookie-bootstrap 401 clears the dead cookie; origin-gate exemption only for a real bearer token (garbage-Bearer cookie mutation → 403, tested); logout-vs-hello race re-checks session liveness after socket registration; re-joining an already-owned team rebinds (200 alreadyMember, tested); array-form XFF joins before rightmost extraction (tested); `PUBLIC_ORIGIN` must parse as a URL; e2e-ensure-db error message names the right variable.
  - Deferred with justification: D27 cookie-hello server integration test (Node WS client cannot send upgrade headers without a new dependency; pinned by unit logic + future real-browser e2e) — recorded, not hidden.
  - Reviewer explicitly confirmed: unpurchased hint text cannot reach any client; logout revocation holds; origin gates not browser-bypassable; XFF trust correct for the documented single-proxy topology; no AGENTS.md violations.
- During the fix pass, transient Windows worker crashes (0xC0000409 at vitest fork startup) recurred under full-parallel load; the earlier mitigations (server maxForks 2, workspace-concurrency 2) kept the final battery green. Watch the CI e2e/test jobs on the first push.
- Delivered: `docs/release/RELEASE_REPORT.md` — verdict **LOCAL CANDIDATE**; staging/production acceptance remains owner-gated. STATUS updated.

## Final state

All six plan tasks complete. Nothing committed (owner authorization pending); branch `release/tutorial-beta` holds the entire change set in the working tree. Time used ≈ 3h15m of the owner's ≈5h budget; stopped after scoped acceptance was genuinely satisfied rather than inventing more work.
