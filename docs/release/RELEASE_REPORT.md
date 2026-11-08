# Release report — tutorial-first public beta candidate

Date: 2026-11-09 · Branch: `release/tutorial-beta` (uncommitted; commit authorization pending) · Base: main@93f20e3
Executor: GLM-5.3 Flash per `docs/superpowers/plans/2026-11-09-production-readiness.md`; ledger: `docs/release/EXECUTION_LEDGER.md`; scope: `docs/release/BETA_SPEC.md`.

## Verdict: LOCAL CANDIDATE

The code passes every gate this machine can run. It is **not** staging-accepted and **not**
production-approved: no HTTPS host, real OAuth, persistence-over-restart, or backup/restore
has been exercised. Those remain owner-gated (below). Green CI does not substitute for them.

## What changed (six tasks, all complete)

1. **Trustworthy verification.** Server DB tests no longer silently skip: `TEST_DATABASE_ADMIN_URL`
   drives the admin connection, `REQUIRE_POSTGRES=1` (CI) hard-fails the run when Postgres is
   unreachable, and a CI grep rejects any skipped/todo tests. CI gained an e2e job (bundled
   chromium, fresh DB per run, workers=1, JSON+HTML report uploads — no traces/screenshots on
   public CI). Playwright is env-driven (browser channel, admin DB URL) with `reuseExistingServer`
   off in CI. Destructive test setup refuses non-local admin hosts without explicit opt-in.
2. **Identity, recovery, live teams.** One authoritative `resolveSessionTeam` for REST and WS (a
   joined player's writes and live stream can no longer diverge); recovery returns a player to
   their last team; team join is transactional (`FOR UPDATE`, cap race closed); re-joining an
   already-owned team rebinds instead of 500ing. New `POST /api/sessions/logout` revokes the
   session everywhere — Bearer, cookie, new and OPEN sockets — and clears the cookie. Sign-out
   wipes case presentation state (browser history/views/bookmarks, terminal scrollback, note
   drafts). Guest recovery code survives follow-up fetch failures; the landing offers a retry
   that re-enters the existing session instead of creating another guest. Cookie-only bootstrap
   works (OAuth can complete; token never exposed to JS; WS hello authenticates via the signed
   upgrade cookie — schema change D27).
3. **Deployment + security.** `/readyz` 503 when unready; rate limiting keys on the rightmost
   proxy-added X-Forwarded-For entry under `TRUST_PROXY=1` (forged chains and repeated headers
   handled); cookie-authenticated mutations require a matching Origin; `/api/*` is `private,
   no-store`; production refuses non-https `PUBLIC_ORIGIN`; WS hello deadline; logout vs hello
   race closed; pool errors can no longer kill the process; OAuth state cookie Secure + 10 s
   upstream deadlines; drain deadline on shutdown. Render blueprint: explicit
   `dockerfilePath`, `TRUST_PROXY=1`, `NODE_ENV=production`, single-replica documented.
   Full §16 audit: `docs/security/audit-2026-11-09.md` (blockers F1–F5 fixed; threat model updated).
4. **Player journey.** Graphical terminal no longer goes blind after Clear or the 500-line cap
   (identity-based sync + container-resize refit); late navigation responses (success or failure)
   cannot clobber a newer page; invalid addresses give feedback; purchased hints are restored from
   a server projection after panel close/reload without a second charge (schema change D28;
   unpurchased tiers never leave the server); private notes refetch on team change, guard against
   double-saves, and keep drafts across app switches; landing links are real and the stale
   "next milestone" team copy is gone.
5. **Performance.** Initial JS: 879 kB → **354 kB minified / 106 kB gzip** (−58%); the evidence
   board (61 kB gzip) and graphical terminal (86 kB gzip) load on demand, each wrapped in a chunk
   error boundary with a real reload affordance so a failed chunk kills one window, not the desktop.
6. **Acceptance.** Independent whole-branch review (fresh context) found no blockers; its one major
   (missing error boundary) and effect-worthy minors were fixed in one pass with regression tests.
   Deferred items are listed below — none silently.

## Verification evidence (this machine, this session)

| Gate | Command | Result |
| --- | --- | --- |
| Build | `pnpm build` | exit 0 (web: 354 kB initial / 106 kB gzip) |
| Tests | `pnpm test` | **395 passed / 0 skipped** (was 314/42-skip) across 9 packages |
| Lint | `pnpm lint` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Headless integration | `pnpm run test:integration` | 29 passed |
| Browser acceptance | `pnpm exec playwright test --workers=1 --retries=0` (bundled chromium, fresh DB) | **4/4**: guest start + axe (zero serious/critical), full tutorial completion, keyboard-only completion, compact/mobile |
| Dependencies | `pnpm audit --prod --audit-level high` | clean (2 moderate advisories resolved by updating @fastify/static) |
| Secrets | gitleaks (35 commits + working tree) | no leaks (local git-ignored `.env` flagged as expected) |
| Required-DB gate | `REQUIRE_POSTGRES=1` with a dead DB URL | run fails loudly (exit 1, clear message) — skip-proofing verified |
| Review | independent fresh-context review of the whole diff | no blockers; 1 major + minors fixed with tests |

Environment note: these runs used Node 24.15.0 / pnpm 12.16.1 (owner-approved deviation D1;
AGENTS.md still says Node 22 — disclosed, not silently changed). Docker Postgres (`iz-dev-pg`)
was running; all DB-backed tests executed against real isolated databases.

## Known limitations (honest)

- **Staging acceptance not performed** (owner-gated): HTTPS + headers on a real host, real OAuth
  sign-in end-to-end, persistence across a real restart, backup/restore drill, uptime alerts.
- **Single replica only**: WS rooms, locks, rate-limit buckets and MCP counters are process-local.
- **Deferred UX (recorded in the ledger, not release blockers)**: modal focus trap/inert
  backgrounds, DOM-focus window activation, network links revealing the browser in compact mode,
  notebook tab arrow-key navigation, shell-level tutorial-completion/replay UI (the tutorial ends
  with visible in-fiction output today). Axe currently reports zero serious/critical findings.
- **WS cookie-hello has no server-side integration test** (Node's WebSocket client cannot send
  upgrade headers without a new dependency); the contract is pinned by unit-level resolution logic
  and will be exercised by the real-browser e2e once OAuth is enabled. Deliberate, disclosed gap.
- Lighthouse/LCP field measurements need a deployed host; bundle-size targets were met locally.
- The reference agent remains stub-tested (scripted model); no real-provider claims are made.

## Exact owner steps from here

1. Read this report and `docs/release/EXECUTION_LEDGER.md`. **Authorize commits** (nothing is
   committed yet — the whole change set is the uncommitted working tree on `release/tutorial-beta`),
   then push the branch and open a PR; watch the new CI (it now runs the DB suite with
   `REQUIRE_POSTGRES=1` and a browser job).
2. Optional staging (recommended before any public link): Render blueprint → `./infra/Dockerfile`,
   one replica, secrets per `docs/release/MANUAL_LAUNCH.md`, then verify `/readyz` 200/503, HTTPS
   cookies, a full tutorial run, restart persistence and a backup restore into a disposable DB.
3. GitHub sign-in stays optional: register the OAuth app with callback
   `https://YOUR-DOMAIN/api/auth/github/callback` only after step 2; guest play does not need it.
4. Public announcement/tag is a separate owner decision after staging acceptance.
