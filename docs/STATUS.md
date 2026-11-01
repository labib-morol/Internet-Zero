# STATUS — INTRANET ZERO

Last updated: 2026-11-02 (M0 planning session — no app code written yet).

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

## Feature ledger (§19.5 format)

| Feature | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Repo hygiene: private docs and .env ignored | done | `git check-ignore -v` matched all three (2026-11-02) | protective rule added before first commit |
| Environment + dependency verification (§0.1/§0.3) | done | this file, tables above (2026-11-02) | D1/D2/D3 open |
| Toolchain bring-up (Node/pnpm/docker daemon) | done | pnpm 12.16.1, node v24.15.0 (D1), docker server 29.6.1 up; see test log (2026-11-02) | |
| Monorepo scaffold (strict TS, ESLint, Prettier, Vitest) | done | `pnpm build`/`pnpm test` 10/10, `pnpm lint` clean (2026-11-02) | ESLint game-logic import bans active in eslint.config.mjs |
| §4.1 third-party skills + AGENTS.md | not started | | |
| packages/schema | not started | | |
| packages/compiler core (load, hash, emit) | not started | | |
| packages/compiler checks 1–12 + fixtures | not started | | |
| worlds/tutorial "Lost and Found" compiles | not started | | |
| packages/runtime apply/fold | not started | | |
| Determinism property tests | not started | | |
| Headless tutorial playthrough (actions only) | not started | | |
| Server skeleton + Postgres + event store + /healthz /readyz | not started | | needs Docker daemon running |
| Dockerfile + compose up | not started | | |
| CI green on a PR | not started | | needs push auth (D5) |
| M0 gate (§19.1) | not started | | build + headless play + property test |
| M1 (desktop shell, services UI, NODE_17 stages) | not started | | explicitly out of scope for now |
| M2 (MCP, teams live sync, forum, deploy) | not started | | explicitly out of scope for now |
