# PLAN — M0 Foundation (current milestone only)

Scope per master prompt §19.1 M0, with the owner's constraint: M0 only, tutorial world
"Lost and Found" playable start to finish, no NODE_17 content, no M1/M2 features.

**Interpretation of "playable from start to finish":** in M0 that means the tutorial is
playable headless — a test drives it purely through runtime actions and reaches the
ending — plus a server that persists and serves that play. The desktop shell UI is M1
and is excluded here. If the owner wants browser-playable in M0, that changes the plan
(say so before approval).

Non-goals for M0: NODE_17 world (private repo only, and only when the owner provides it),
MCP server, forum, teams live sync, GitHub sign-in, Render deploy, evidence board UI.

Prerequisites (owner decisions D1–D3 in docs/DECISIONS.md): Node version, pnpm enablement,
TypeScript line.

| # | Task | Files | Test | Done condition |
| --- | --- | --- | --- | --- |
| 1 | Toolchain bring-up | `.nvmrc` or version manager setup, `packageManager` field | `node -v`, `pnpm -v`, `docker info` recorded in STATUS | prompt-required versions running, or recorded owner-approved deviation |
| 2 | Monorepo scaffold | `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json` (strict), ESLint flat config (import bans per §4.2/§10.5), Prettier, Vitest workspace, stub packages for the §5 tree | `pnpm install`, `pnpm build`, `pnpm -r test` green on stubs; ESLint ban fires on a fixture violation | all green, bans proven active |
| 3 | Skills + AGENTS.md | `.agents/skills/*` per §4.1 (with licenses), `AGENTS.md` per §4.2, `THIRD_PARTY_NOTICES.md` | clone/copy verified; each SKILL.md loads | skills discoverable, notices recorded |
| 4 | packages/schema | `packages/schema/src/**` (world source, bundle, Action, GameEvent, Rejection, RuntimeState, ViewModels, REST/WS/MCP I/O per §19.3), JSON Schema export | Vitest: valid/invalid fixtures, unknown-key rejection, Condition recursion, id regex | `pnpm --filter schema test` green |
| 5 | compiler core | `packages/compiler/src/**`: YAML load, artifact loaders (forge/mail/archive/terminal), safe mdast compile (§10.6 allowlist), salted answer hashing, bundle emit + `bundleHash` | unit tests per stage; safe-AST rejects scripts/handlers/`javascript:` | compiler builds a minimal valid fixture world |
| 6 | compiler checks 1–12 + `iz` CLI | check modules, `report.json` emitter, `bin/iz`; fixtures: one valid world + ≥12 invalid worlds (one per check) | each check trips its named fixture; valid world passes | `iz build <fixture>` exit codes correct for all fixtures |
| 7 | worlds/tutorial | `worlds/tutorial/**` per Appendix B (suffix `pcp`, forge/mail/printer hosts, 3 gates, r.final, 3×3 hints) | `iz build worlds/tutorial` + `--report` clean, reachability tree complete | bundle in `dist/worlds/`, zero errors/warnings |
| 8 | runtime core | `packages/runtime/src/**`: apply/fold, RuntimeState, conditions, gates, deterministic ids, evidence/claims/links | unit tests + determinism seeded-id tests | green; no Date.now/random/uuid in package (lint-proven) |
| 9 | runtime completion + property tests | report grading, hints/costs, rate limits (§8), world events at apply start (§13), unlocks | property: fold(apply seq) == sequential state; chunked fold == full fold; normalization idempotent | property tests green in CI-repeatable mode |
| 10 | headless tutorial playthrough | `test/m0-playthrough.spec.ts`: scripted actions from entry to ending | test plays tutorial by actions only, reaches ending | M0 gate condition 2 passes |
| 11 | server skeleton + event store | `apps/server/**`: Fastify, Drizzle schema + migrations (§15 tables), event append UNIQUE(team_id,seq) + retry (§12), guest session, minimal action REST, `/healthz` `/readyz` | integration tests vs Postgres (compose db); two-team isolation basics | `/readyz` reports db + migrations + bundles OK |
| 12 | infra | `infra/Dockerfile` (multi-stage, non-root, 8080), `infra/docker-compose.yml` (db healthcheck + app), `.env.example` (§17.2) | `docker compose up -d` → `/readyz` 200 | recorded in STATUS with command output |
| 13 | CI | `.github/workflows/ci.yml`: install cache, lint, typecheck, unit, `iz build worlds/tutorial`, integration with Postgres service, build | open a PR → workflow green | green run linked in STATUS (needs push auth, D5) |
| 14 | M0 gate + docs | STATUS ledger update, `docs/architecture/overview.md`, DECISIONS recap | run all three §19.1 M0 gate conditions | gate table complete in STATUS |

Order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14. Tasks 4–7 can start
only after 2; tasks 8–10 after 4. After every task: `pnpm build && pnpm test` and the
server (once it exists) still starts — never leave main broken (§0.7).

---

# PLAN — M1 Playable slice (drafted during M0; build starts after the M0 gate)

Scope per master prompt §19.1 M1: desktop shell, browser router, forge, mail, archive,
terminal, notebook, board, gates, reports, hints, guest sessions. The browser-playable
tutorial is the acceptance target (owner constraint). NODE_17 stages are NOT built
tonight (owner directive; needs the private content repo). Forum, GitHub sign-in, team
live sync are M2.

Owner decisions applied: Node 24 / node:24-slim (D1), TS 6 (D3), headless M0 (D8).
M0 contracts frozen in packages/schema — M1 builds view models on them (no schema edits
without a DECISIONS note).

| # | Task | Files | Test | Done condition |
| --- | --- | --- | --- | --- |
| 1 | Design tokens + window chrome kit | packages/ui/src/** (tokens, Window, Dock, MenuBar) | vitest render tests (vitest + @testing-library/react — add exact-pinned devDeps) | kit builds; a11y labels on all controls |
| 2 | Desktop shell | apps/web/src/shell/** — window manager (drag/resize/focus/minimize, Alt+N, <900px single-window), local-storage persistence | component tests + Playwright smoke: open two windows, focus, minimize | shell usable; shell tests green |
| 3 | In-game browser + router | apps/web/src/browser/** — address bar, history, bookmarks, network directory; resolves hosts via POST /api/actions open | component tests: unknown host renders indistinguishable not-found; locked host same | router never navigates for real (no window.location use) |
| 4 | Service UI: GIT//FORGE | packages/ui + apps/web/forge/** — repo home, commit list/detail with diff + signature panel, file browser, issues, user profile (deleted state) | per-route view-model render tests from compiled tutorial bundle | every forge route renders its ViewModel; Collect works |
| 5 | Service UI: DEADLETTER | mail/** — mailbox, thread, message, headers ("view source"), inspect-layers for removable redactions | view tests incl. redaction not in DOM until inspected | mail views complete; collect works |
| 6 | Service UI: THE ARCHIVE | archive/** — search, results, document, metadata inspector | view tests; search only shows visible artifacts (server already filters) | archive views complete |
| 7 | Service UI: NODE TERMINAL | terminal/** — xterm.js + fit addon, line submission, passphase prompt flow via submitAnswer, screen-reader ARIA live region | component test: emits terminal action with whole line; SSR mode renders output as live region | terminal works against apps/server; wheel-free |
| 8 | Case file side panel + gates/reports/hints UI | apps/web/src/case/** — open gates, accepted groups, submit answer/report, hint request with costs | component tests: report grading feedback (accepted groups only) | player can solve tutorial purely in browser |
| 9 | Notebook + evidence board | notebook/** (list, filters, private notes), board/** (@xyflow/react canvas, doc-card vs note nodes, relations, auto-layout, keyboard operable) | component tests + keyboard path test | collect → appears in notebook → drag/link on board |
| 10 | Session flow + landing page | landing/** (one-click guest start, no signup wall), session create/resume with recovery code display | Playwright: guest start lands on desktop; recovery code shown once | landing → tutorial start works |
| 11 | server: view-model projection | apps/server/src/views/** — ServiceModule view()/collectibles() now real (move from compiler-only loaders); GET /api/view?host=&path= route | integration: every route on the tutorial bundle; leak suite (locked artifacts never in responses, 12-char substring sweep) | all view models served; leak suite green |
| 12 | Snapshots + presence groundwork | apps/server: snapshot every 200 events (§15 cache) | integration: fold-from-snapshot == fold-from-log | snapshot cache used on state load |
| 13 | Playwright e2e: full tutorial in browser | test/e2e/tutorial.spec.ts — guest → finish tutorial; mobile viewport smoke; keyboard-only path; axe scans on core screens | pnpm exec playwright test | M1 gate: e2e completes tutorial; axe no serious issues; leak suite green |
| 14 | M1 gate | STATUS ledger, HANDOFF, DECISIONS | §19.1 M1 gate minus NODE_17 stage 1 (blocked on private repo) | recorded in STATUS |

Order: 1 → 2 → 3 → 11 (server views early, parallel with UI) → 4..8 → 9 → 10 → 12 → 13 → 14.
