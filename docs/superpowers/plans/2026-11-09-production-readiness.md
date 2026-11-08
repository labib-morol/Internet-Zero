# Tutorial-first Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use the available `executing-plans` skill to implement task-by-task. Skill references with a `superpowers:` prefix mean the corresponding installed skill; do not invent unavailable tools. GLM-5.3 Flash is the requested executor, not this planning session.

**Goal:** turn the existing game into a reliable, polished tutorial-only public beta, with honest release evidence and a short owner deployment checklist.

**Architecture:** preserve the fictional-desktop UI and existing package boundaries. Fix correctness/security before polish. Initial hosting is one server process/replica, managed Postgres and image-baked tutorial assets; private NODE_17 stays excluded.

**Tech Stack:** strict TypeScript, pnpm 12.16.1, React/Vite, Fastify, Postgres/Drizzle, Vitest, Playwright, MCP.

**Spec:** `docs/release/BETA_SPEC.md`. Owner actions: `docs/release/MANUAL_LAUNCH.md`.

## Starting evidence—not a production sign-off

HEAD at inspection: `93f20e3`. `docs/STATUS.md` records GitHub CI green on November 5; early M0/M1 sections are historical. MCP, teams, forum and OAuth server scaffolding exist; do not rebuild them from scratch. Read-only code inspection found the specific gaps below. Browser/staging acceptance was not run in this planning session. Docker currently fails with missing `dockerDesktopLinuxEngine`; DB acceptance is blocked until restored.

## Global constraints and execution instructions to GLM

- Read `AGENTS.md`, latest `docs/STATUS.md`, `docs/PLAN.md`, this plan and its spec first. Preserve strict TS, runtime-only game logic, safe rendering, fictional routing and all anti-leak/anti-execution rules.
- Recorded owner-approved Node 24 deviation is `docs/DECISIONS.md` D1; current machine is 24.15.0, while AGENTS still says 22. Report this conflict; do not silently edit instructions or claim Node 22 tested.
- Create a feature branch before implementation. No commits unless the owner explicitly authorizes them; no push, merge, publishing, paid services, external AI calls or production DB changes without separate authorization. Keep private docs, answers, credentials and generated private bundles out of git and uploaded artifacts.
- Use TDD for code changes: named failing regression → minimal fix → targeted pass → **`pnpm build && pnpm test` after every task**, and update STATUS. Use `systematic-debugging` for failures; never weaken assertions, hide skips, raise limits merely to suppress symptoms, or substitute mock DB results for Postgres acceptance.
- Use the installed `security-audit`, UI/design/browser skills when applicable. Browser interaction must follow `browser-use:control-browser`; do not substitute ad-hoc browser tooling. Preserve incumbent design, not a redesign. Keep scope and temporary artifacts isolated.
- Track tasks, test outcomes, decisions and remaining blockers in `docs/release/EXECUTION_LEDGER.md`. Resume from that ledger after context compaction; do not redo completed work.
- **Use available tokens freely for useful implementation, adversarial tests, debugging and independent review. Do not optimize for token conservation at the expense of quality—but do not burn tokens, repeat audits, invent features or overengineer simply because capacity remains.** Actual time and acceptance gates, not the claimed quota, govern completion.
- Approximate five-hour allocation: 30m verification infrastructure, 70m session/team correctness, 45m production safety, 75m UX repairs, 30m performance/docs, 50m final acceptance. Estimates are not promises. At 60m remaining, freeze new features and verify; at 15m remaining, write the exact handoff. If blockers remain, label **NOT READY**, never lower the bar.

## Review Focus

1. A guest created just before a network failure retains the one-time recovery handoff; retry never silently creates another account.
2. A team switch/recovery/disconnect mid-replay cannot display a predecessor team's cached content or skip unconsumed events.
3. Cookie-only login, logout and expiry behave consistently across HTTP and an already-open WebSocket; hostile origins cannot mutate state.
4. Late navigation/save replies and terminal buffer rollover cannot discard drafts or display stale content under a new address.
5. Fresh-checkout CI and failed readiness cannot look green while required DB/browser checks did not execute.

Every task uses the same cycle: write the named regression first, observe its failure, implement, run targeted tests, run build/test, record evidence. For documentation-only changes, validate instructions/links instead of manufacturing a failing unit test.

---

### Task 1 — Make test results trustworthy [release blocker]

**Modify:** `apps/server/test/helpers.ts`, `.github/workflows/ci.yml`, `playwright.config.ts`; relevant server test configs. **Add:** `apps/server/test/db-required.test.ts` and browser artifact steps.

**Interfaces:** introduce test-only `TEST_DATABASE_ADMIN_URL` and `REQUIRE_POSTGRES=1`. Helpers derive isolated per-test database URLs from that admin URL; preserve unique creation/cleanup. CI supplies its actual Postgres credentials. Never accept a production connection for destructive test setup.

- [ ] Regression: wrong credentials with `REQUIRE_POSTGRES=1` fail the suite/job, not skip; a valid URL executes real DB tests; DB names are isolated. Existing hardcoded `intranet/intranet` conflicts with CI `postgres/postgres` (`helpers.ts:17,67–74`; `ci.yml:16–29`).
- [ ] Fix helpers and explicitly required CI mode. Restore local Docker or use owner-provided disposable Postgres; continue safe frontend work if blocked, but do not declare DB acceptance passed.
- [ ] Use bundled Chromium in CI, configurable browser/DB locally, fresh CI web servers (`reuseExistingServer:false`), explicit CI retries policy, browser install and always-upload sanitized failure artifacts. Current fixed Edge channel has no real fallback.
- [ ] Verify `pnpm --filter @iz/server test`, `pnpm run test:integration`, `pnpm exec playwright test --workers=1 --retries=0`; required suites have zero skips. Deliberately invalid DB credentials must fail. Upload failure artifacts without tokens, cookies, recovery codes, private notes or answers.

### Task 2 — Repair identity, recovery and live team state [release blocker]

**Modify:** `apps/server/src/auth.ts`, `ws.ts`, `routes/sessions.ts`, `routes/github.ts`, `routes/teams.ts`, relevant `db/*`; `packages/ui/src/state/session.ts`, `api/ws.ts`; web `Shell.tsx`, browser/terminal stores, `LandingPage.tsx`, `RecoveryModal.tsx`. **Tests:** extend `teams-m2.test.ts`, `github-m2.test.ts`, `sessions.test.ts` if present; add `apps/server/test/session-lifecycle.test.ts`, `apps/server/test/ws-session.test.ts`, `apps/web/test/session.test.tsx` as needed.

**Interfaces:** one authoritative session-selected-team/membership resolver for REST and WS, not `firstTeamForUser`. Cookie-authenticated browser bootstrap and WS use server-side HttpOnly cookie validation; preserve explicit Bearer authentication for authorized nonbrowser clients. New logout endpoint `POST /api/sessions/logout` revokes the current session and clears its cookie. Session/team generation gates late UI replies and socket callbacks.

- [ ] Tests: invite → join → WS reconnect → REST/live replay agree; wrong-team events absent; shorter-team cursor resets; interrupted replay resumes from last **consumed** event; stale callbacks ignored; capacity remains six under simultaneous joins and existing-member rejoin works.
- [ ] Preserve selected team on recovery. If a recovery code has ambiguous multiple-team history, define an explicit selection flow rather than silently selecting the first team. Transactionally check membership/capacity and rebind sessions.
- [ ] Tests: sign-out/expiry invalidate old cookie, copied token and open socket; new guest never sees previous cached views/transcripts. Reset case-specific caches, not user visual preferences; prevent late async replies repopulating them.
- [ ] Tests: guest response received then state fetch fails retains recovery code in memory; retry uses existing session without another creation. Copy success/denial has feedback; code never enters persistent browser storage.
- [ ] OAuth: fix landing link and bootstrap with empty sessionStorage, cookie-only reload and cookie-authenticated WS; never expose HttpOnly token to JS. Test callback errors/timeouts and expired/tampered state. If credentials or implementation cannot be verified, leave OAuth disabled and accurately labeled; do not block guest beta on account credentials.

### Task 3 — Make deployment and security safe [release blocker]

**Modify:** `apps/server/src/routes/health.ts`, `config.ts`, `security.ts`, `app.ts`, `index.ts`, `ws.ts`, `db/client.ts`; `infra/render.yaml`, `infra/docker-compose.yml`, deploy/security docs. **Tests:** extend health/security suites; add `apps/server/test/production-safety.test.ts`.

**Interfaces:** `/healthz` is liveness; `/readyz` is HTTP 200 only when all required checks pass, otherwise 503. Production origin is one canonical HTTPS origin. Cookie mutations and browser WS enforce exact allowed Origin/CSRF policy; nonbrowser Bearer rules stay explicit. Proxy trust is bounded to the actual host topology.

- [ ] Tests: DB outage/migration failure → 503, recovery → 200; invalid production HTTP origin rejected; hostile/sibling/null/absent Origin handled deliberately; legitimate requests work. Test trusted-proxy client separation and forged forwarding headers from an untrusted peer.
- [ ] Set Render `dockerfilePath: ./infra/Dockerfile` and validate nested Blueprint selection, migration/start commands and tutorial-only assets. Keep local asset support truthful; defer unused R2/S3 claims.
- [ ] Add private/no-store caching for authenticated session/state/note responses; preserve visibility-checked assets and strict headers. Set secure OAuth state cookies and network deadlines in the transport layer.
- [ ] Define bounded WS authentication/replay/output queues, consumed-event cursors, heartbeat/expiry and shutdown deadlines. Test a slow/disconnected receiver, query stall and graceful drain with local/isolated infrastructure; never run disruptive experiments on production.
- [ ] Document one process/replica and rolling-deploy overlap limits; do not enable horizontal scaling. No automatic mutation retries without idempotency. Reproduce committed-response-loss/sequence-conflict paths before changing retry behavior; document limitations or add request deduplication if required.
- [ ] Refresh the full security requirement table with current teams/OAuth/MCP behavior; run anti-leak/import/payload/isolation suites, dependency and secret scans. No open blocker/major for the launch scope. Update threat model, not just its sign-off date.

### Task 4 — Fix the player journey, then polish [high priority]

**Modify:** `apps/web/src/browser/{store.ts,BrowserWindow.tsx}`, notebook/`PrivateNotes.tsx`, `NotebookWindow.tsx`, `shell/{Shell.tsx,CaseFilePanel.tsx}`, shared dialogs, `network/NetworkDirectory.tsx`, `services/terminal/{TerminalConsole.tsx,terminal-store.ts}`; `packages/ui/src/window.tsx`; server/runtime projections where required. **Tests:** existing web/component suites plus `test/e2e/tutorial.spec.ts` and `test/e2e/session-team.spec.ts`.

**Interfaces:** current-navigation request identity governs every success/failure/back-forward response. Purchased-hint projection exposes **only already-purchased** text, with no extra charge. Completion is derived by runtime and safely projected to UI, never inferred by client answer logic.

- [ ] Navigation tests: late success/failure cannot overwrite newer address; no old page controls under a new loading/error state; invalid address and retry are actionable. Do not expose locked-host distinctions.
- [ ] Notes/hints tests: failed save retains draft and retry; double-save one write; app switching preserves draft or explicitly confirms discard; same-token team switch reloads scoped notes; full reload restores saved notes and purchased hints without another charge. Do not persist private drafts in shared/public caches.
- [ ] Terminal tests: Clear clears graphical xterm and next output renders; newest output appears after 500-line rollover; container resize/minimize/reopen refits; busy submission has explicit feedback. Existing browser test uses screen-reader mode; also verify actual graphical terminal.
- [ ] Accessibility tests: modal Tab/Shift+Tab containment, Escape/explicit-dismiss policy and focus restoration; background inert; app switch focuses usable content; focused windows rise; Network links reveal Browser in compact mode; notebook tabs have correct keyboard/panel behavior.
- [ ] Preserve the quiet desktop/brass/service-skin design. Improve readable spacing, contrast, focus, loading/error/empty/success states and touch targets. Inspect desktop, 390px, 320px, short landscape, 200% zoom and reduced motion; recover offscreen saved window geometry. Do not add decorative animation or new theme systems.
- [ ] Complete onboarding with tutorial-first guest CTA, concise controls/help, honest OAuth/team labels and real approved public links. Add accessible completion feedback and an explicit fresh-case/replay action with new recovery handoff; never overwrite the finished case silently.

### Task 5 — Performance and honest public documentation [after blockers]

**Modify:** measured heavy imports in web shell/terminal/board, Vite configuration only as needed; `README.md`, `docs/HANDOFF.md`, `docs/deploy/render.md`, security/MCP docs, notices. **Add:** `docs/release/RELEASE_REPORT.md`.

- [ ] Measure startup and bundle sizes before/after. Current build emits one ~879 kB minified/~251 kB gzip JS chunk. Lazy-load graphical terminal/evidence board and other measured heavy surfaces with usable loading/failure fallbacks; do not simply increase the warning threshold or memoize everything.
- [ ] Proposed measurement targets, not existing guarantees: initial JS ≤200 kB gzip; local controlled mobile Lighthouse LCP ≤2.5s, CLS ≤0.1. Record tool/device/throttle and justify deviations. Field INP cannot be established from a short local run. Test interactions and layout, not scores alone.
- [ ] Reproduce quick start from a clean checkout: `.env` before Compose, real secret generation, reachable DB for host-based dev or documented full-container path. Correct stale “unbuilt” features/contact links and sample-world attribution; preserve private content exclusions.
- [ ] Real-reference-agent/competitive claims are not release prerequisites. Current test uses scripted chat, not a real model. Either validate the tool-call contract with owner-approved provider credentials or label it stub-tested and deferred. Do not spend external credits or upload content without consent.

### Task 6 — Final acceptance, independent review and delivery [mandatory]

**Interfaces:** final report records exact commit/diff, commands, passed/failed/skipped counts, browser engine/viewports, sanitized evidence and owner blockers. Release verdict is **LOCAL CANDIDATE / STAGING ACCEPTED / NOT READY**, never an unsupported “production-ready.”

- [ ] Run fresh: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm run worlds:build`, `pnpm test`, `pnpm run test:integration`, `pnpm exec playwright test --workers=1 --retries=0`, `pnpm audit --prod --audit-level high`, and the installed secret/import/security scans. Build precedes typecheck on a fresh checkout. Triage advisories; no broad new allowlists.
- [ ] Browser acceptance: guest → evidence → gates/report → explicit finish, reload/recovery, real Tab traversal (not direct `.focus()` shortcuts), every compact app, graphical terminal, team join/live/reconnect, notes and purchased hints; axe no serious/critical, remaining findings assessed. Keep traces/reports sanitized. CI green alone is insufficient.
- [ ] One independent whole-branch correctness/security review and one rendered-web UX review using supported browser tooling, then reproduce/fix material findings and rerun affected gates. If review tooling is unavailable, record self-review honestly. Do not use document visual-judge agents for web UI.
- [ ] Validate Docker image/non-root boot and health locally when available. Owner-authorized staging must prove migration, HTTPS, cookies/headers, real OAuth if enabled, persistence after restart, isolated backup/restore and alert delivery. Keep these **blocked/manual** until actually observed.
- [ ] Deliver `RELEASE_REPORT.md`: what changed, evidence, known limitations, no-open-blocker verdict for tested scope, manual owner actions, next exact command. Update STATUS with latest evidence; preserve historical logs rather than rewriting them as passes.

## If the plan finishes before time/quota expires

Spend remaining useful time in this order: reproduce review findings → test reconnect/reload/rapid navigation/concurrent joins/long sessions → blind tutorial playtest without canon → fix verified accessibility/performance regressions → document deferred work. Keep test data synthetic and isolated. No real attack traffic, production load tests, new worlds, unrelated rewrites or endless agent loops. When all scoped gates are satisfied and the report is honest, stop. Quality is the goal; exhausting tokens is not.
