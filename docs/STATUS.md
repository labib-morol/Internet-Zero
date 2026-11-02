# STATUS — INTRANET ZERO

Last updated: 2026-11-02 (progress checkpoint after M1 UI integration).

## Latest verification checkpoint

- `pnpm build` — passed; Vite warns that the frontend bundle exceeds 500 kB.
- `pnpm lint` — passed.
- `pnpm test` — 289 tests passed; 25 server tests skipped because Docker/Postgres is unavailable now. A skipped suite is not a passing DB verification.
- `pnpm run test:integration` — 27 passed, including the headless tutorial, view tests, leak sweep and scorer tests.
- `pnpm --filter @iz/web test` — 88 passed across 11 files. jsdom reports missing canvas support; the UI kit also reports invalid table nesting. Browser acceptance remains unverified.
- Local git history contains 23 commits. Nothing was pushed. Both source documents and `.env` remain ignored.
- Full browser tutorial, mobile/keyboard end-to-end checks and axe acceptance have not run. MCP server/tool execution and oracle/benchmark runs remain unimplemented; scorer code and its tests exist.

## Environment

Host: Windows 10.0.26200 x64, Git Bash. Workspace: `C:\Users\T14S\BUP Hackathon`
(folder rename to "Internet Zero" pending — Windows reported the folder busy while
the ZCode workspace was open; see DECISIONS D7).

| Tool | Master prompt expects | Found on this machine | Verdict |
| --- | --- | --- | --- |
| Node.js | 22 LTS | v24.15.0 | approved deviation — Node 24 LTS (DECISIONS D1, owner-approved 2026-11-02) |
| pnpm | workspace package manager | 12.16.1 installed via `npm i -g pnpm` (corepack hit EPERM on Program Files) | resolved (D2) |
| npm | — | 11.12.1 | fine (used for registry lookups) |
| Docker CLI | docker compose for Postgres/self-hosting | 29.6.1 | fine |
| Docker daemon | must run for M0 server tests | RUNNING — Docker Desktop started 2026-11-02, server 29.6.1, ready in ~10 s | ok |
| Docker Compose | — | v5.2.0 | fine |
| git | — | 2.54.0.windows.1 | fine |
| gh CLI | PR/CI verification, repo visibility checks | not installed | install or use Git Credential Manager for push auth (D5) |

Repository state: branch `main`, zero commits, `origin` → `https://github.com/labib-morol/Internet-Zero`
(empty on GitHub, reachable anonymously). Two private documents in the workspace are
git-ignored (evidence: `git check-ignore -v` matched both, 2026-11-02).

### Session tooling inventory (master prompt §0.2)

Skills present in this session: browser-use (control-browser, web-gui-tester), documents
(docx/pdf/pptx/xlsx toolkits + viewers), dynamic-workflows, visualize, skill-creator,
zcode-guide diagnostics, hyperframes family, general-video, media-use, impeccable,
reverse-engineer-anything.

Subagents: Explore, general-purpose, visual-judge (document types). No custom project subagents.

MCP servers: `web_reader` only, plus built-in web search/fetch. Not configured (per §4.3,
none are required for M0): GitHub MCP, Context7, Render MCP, Playwright MCP (prompt says
use Playwright CLI instead).

Missing vs. the prompt: the six third-party skills from §4.1 (superpowers set, webapp-testing,
mcp-builder, frontend-design, web-design-guidelines) and the six project skills from §20 —
installed/created in M0 task 4. The `frontend-design` / `web-design-guidelines` skills are
only needed for UI work (M1) and arrive with the §4.1 install.

## Dependency verification (§0.3 — checked 2026-11-02 via `npm view`, registry live)

| Package | Prompt expectation | npm latest | License | Verdict |
| --- | --- | --- | --- | --- |
| zod | Zod 4 | 4.6.7 | MIT | OK |
| fastify | Fastify server | 5.12.7 | MIT | OK |
| @fastify/websocket | WebSocket | 11.3.6 | MIT | OK |
| @fastify/static | SPA hosting (implied) | 10.1.8 | MIT | OK |
| @fastify/cookie | cookie sessions | 11.1.5 | MIT | OK |
| drizzle-orm / drizzle-kit | Postgres ORM + migrations | 0.45.4 / 0.31.11 | Apache-2.0 / MIT | OK |
| pg | Postgres driver (paired with Drizzle) | 8.23.1 | MIT | OK (`postgres` 4.0.0 also exists; `pg` chosen, see D6) |
| vite | client build | 8.3.5 | MIT | OK |
| react / react-dom | UI | 19.3.1 | MIT | OK |
| tailwindcss | styling | 4.3.3 | MIT | OK |
| @tanstack/react-query | server state | 5.105.1 | MIT | OK |
| zustand | UI state | 5.0.16 | MIT | OK |
| @xterm/xterm + addon-fit | terminal UI | 6.0.0 / 0.11.0 | MIT | OK |
| @xyflow/react | evidence board | 12.12.0 | MIT | OK |
| pino | logging | 10.4.0 | MIT | OK |
| vitest | unit/property tests | 5.0.5 | MIT | OK |
| @playwright/test | e2e | 1.64.1 | Apache-2.0 | OK |
| @playwright/cli | §4.1 install command | 0.1.23 | Apache-2.0 | exists — §4.1 command is valid |
| typescript | "TypeScript (strict)", unpinned | 7.0.2 (latest); 6.0.3 and 5.x also published | Apache-2.0 | pin decision (D3) |
| eslint / prettier | lint/format | 10.14.0 / 3.9.10 | MIT | OK |
| yaml | world source parsing | 2.9.1 | ISC | OK |
| unified / remark-parse / remark-gfm | safe mdast compile | 11.0.5 / 11.0.0 / 4.0.1 | MIT | OK |
| @modelcontextprotocol/sdk | BANNED by prompt (v1) | 1.32.2 | MIT | will not be used |
| @modelcontextprotocol/server | prompt's "SDK v2" | 2.4.0 | Apache-2.0 | exists — matches prompt |
| @modelcontextprotocol/fastify | prompt's "SDK v2" Fastify adapter | 2.0.1 | Apache-2.0 | exists — matches prompt |
| @modelcontextprotocol/client | implied by §14.3 "official client package" | does not exist | — | resolve from SDK v2 docs in M2 (D4) |

Findings: every package the prompt names exists. The two MCP "SDK v2" packages the prompt
requires are real. The only open version questions are D1 (Node 22 vs installed 24) and
D3 (TypeScript line). Nothing blocks writing the M0 plan.

## Security notes

- `INTRANET_ZERO_GLM_MASTER_PROMPT.md` contains Appendix C (NODE_17 answer key) and is
  git-ignored. The internal product spec is ignored as well. Neither may ever be committed
  to the public repo. First commit of the repo must not be a blanket `git add .` before
  this ignore rule existed — it did (2026-11-02, before any commit).
- `.env` ignored; `.env.example` will be committed.

## Test log

(append: date — command — summary line; nothing run yet beyond environment checks)

- 2026-11-02 — `git check-ignore -v <two private docs> .env` — all three matched ignore rules.
- 2026-11-02 — `pnpm install --dangerously-allow-all-builds` — clean; esbuild postinstalls ran (D9).
- 2026-11-02 — `pnpm build` — all 10 workspace projects built (tsc 6.0.3, strict).
- 2026-11-02 — `pnpm test` — 10 test files, 10 tests passed, 0 failed (smoke stubs).
- 2026-11-02 — `pnpm lint` — eslint 10.14.0 + typescript-eslint 8.72.1 clean on stubs.
- 2026-11-02 — `pnpm --filter @iz/schema test` — 6 files, 50 tests passed (ids, conditions, gates, safe AST, world/bundle sources, actions/events/WS/REST/MCP contracts, JSON Schema export).
- 2026-11-02 — `pnpm build && pnpm test && pnpm lint` — full workspace green with schema implemented.
- 2026-11-02 — compiler/services/runtime wave: `pnpm test` 152 tests green; `pnpm lint` clean; committed 780aa11.
- 2026-11-02 — `pnpm run worlds:build` — tutorial@1.0.0 compiled: 17 artifacts, 3 gates, bundleHash 3fe80d44…, zero warnings.
- 2026-11-02 — `pnpm run test:integration` — M0 headless playthrough 3/3 passed (completes tutorial by actions only, score 300, deterministic replay, no answer/canon leak); runtime path-matching fix included; committed cffbe9c.
- 2026-11-02 — docker build (infra/Dockerfile) — install + pnpm -r build clean in container; world-compile step proven after tutorial landed (final proof pending at M0 gate).

## Feature ledger (§19.5 format)

| Feature | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Repo hygiene: private docs and .env ignored | done | `git check-ignore -v` matched all three (2026-11-02) | protective rule added before first commit |
| Environment + dependency verification (§0.1/§0.3) | done | this file, tables above (2026-11-02) | D1/D2/D3 resolved |
| Toolchain bring-up (Node/pnpm/docker daemon) | done | pnpm 12.16.1, node v24.15.0 (D1), docker server 29.6.1 up; see test log (2026-11-02) | |
| Monorepo scaffold (strict TS, ESLint, Prettier, Vitest) | done | `pnpm build`/`pnpm test` green, `pnpm lint` clean (2026-11-02) | ESLint game-logic import bans active |
| §4.1 third-party skills + AGENTS.md | done | 10 skills in .agents/skills with licenses; THIRD_PARTY_NOTICES.md (2026-11-02) | commit 3724773 |
| Six project skills (§20) | done | .agents/skills/{world-authoring,story-consistency-audit,blind-playtesting,fictional-service-development,mcp-integration,security-audit}/SKILL.md (2026-11-02) | commit 3ee90f5 |
| packages/schema | done | 50 tests (2026-11-02) | §19.3 contracts frozen; commit b6bf061 |
| packages/compiler (12 checks + fixtures) | done | 23 tests incl. per-check invalid fixtures; `worlds:build` zero warnings (2026-11-02) | commits 780aa11, cffbe9c |
| packages/services loaders | done | 21 tests (2026-11-02) | view()/collectibles() arrive with M1 UI |
| packages/runtime apply/fold + property tests | done | 53 tests incl. fast-check fold==apply, chunked replay (2026-11-02) | commit 780aa11 |
| worlds/tutorial "Lost and Found" compiles | done | 17 artifacts, 3 gates, 9 hints, zero warnings (2026-11-02) | commit cffbe9c |
| Headless tutorial playthrough (M0 gate cond. 2) | done | `pnpm run test:integration` 3/3: completes by actions only, score 300, deterministic, no answer/canon leak (2026-11-02) | commit cffbe9c |
| Security: import scan (§16.1) | done | test/security-import-scan.spec.ts green on runtime/services/terminal/mcp (2026-11-02) | commit 5db13b7 |
| Server + event store + /healthz /readyz (M0 gate infra) | done | 24 tests vs real Postgres incl. isolation + retry race; /readyz {database:true, migrationsCurrent:true} (2026-11-02) | commit 9f49462 |
| Dockerfile + compose + CI workflow files | done | image builds 589 MB; compose config valid; ci.yml mirrors local runs (2026-11-02) | full compose-up proof logged separately |
| CI green on a PR | partial | identical commands run locally and green: lint, typecheck, build, unit+integration, worlds:build, test:integration | blocked: awaiting push auth (D5) — never pushed per owner directive |
| packages/terminal interpreter (M1 groundwork) | done | 18 tests: parser, vfs, all §10.5 commands, pipes, redirect caps, events (2026-11-02) | commit 3ee90f5 |
| M0 gate (§19.1) | done | 1) `iz build worlds/tutorial` zero errors; 2) playthrough test completes tutorial by actions only (3/3); 3) determinism property tests green (fold==apply, chunked replay) — all in the final CI-equivalent local run: lint PASS, typecheck PASS, build PASS, 193 package tests + 7 root integration tests green, `docker compose up` serves /readyz {database:true, bundlesLoaded:1} (2026-11-02, commits up to 93e16d9) | CI-on-PR partial (D5: awaiting push auth); NODE_17-free per owner |
| M1 tutorial UI: desktop, browser, forge/mail/archive, terminal, notebook/board, report/hint panel | partial | code integrated; fresh frontend suite 88/88 passes, build and lint pass | full browser tutorial, mobile, keyboard and axe acceptance not yet run |
| M1 private notes, snapshots and real asset rendering | not started | | UI has explicit deferred placeholders; not counted as real functionality |
| M1 acceptance gate | partial | view-layer leak sweep passes; browser Playwright harness exists | tutorial browser completion and accessibility acceptance not yet verified; NODE_17 intentionally excluded |
| M2 scorer | done | `test/scorer.spec.ts` 2/2 passed in fresh integration run | scorer only; no MCP/oracle benchmark run yet |
| M2 MCP server, tools and tutorial benchmark runs | not started | packages/mcp remains a scaffold | SDK v2 availability checked; not implementation evidence |
| Current Docker/Postgres availability | blocked | Docker API pipe `dockerDesktopLinuxEngine` not found; fresh server suite 25 skipped | earlier DB tests passed; current checkpoint does not claim them as passing |

## Continuation checkpoint
- Docker 29.6.1 restored; existing iz-dev-pg started, no unrelated containers touched.
- `pnpm build`, `pnpm lint`, `pnpm typecheck`: PASS.
- `pnpm test`: 363 passed, zero skipped (including 32 real-Postgres tests).
- `pnpm run test:integration`: 29 passed.
- `pnpm exec playwright test --workers=1 --reporter=line`: 3 passed: guest startup,
  full browser tutorial with evidence-derived answer, compact app switcher + persistent
  private notes. Accessibility scans have no serious/critical findings on those screens.
- Gate integrity, snapshots, private notes, asset hosting and SPA serving are implemented.
- M1 broader security signoff/keyboard-only path and M2 MCP benchmark remain in progress.
