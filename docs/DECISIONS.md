# DECISIONS — INTRANET ZERO

Log of deviations, environment-driven choices and open questions. Format: id, status,
decision/options, reason. Master prompt §0.14: when the file and reality disagree, choose
the simplest option that keeps the architecture — except where the owner's rules require
stopping for a decision (version mismatches, private content).

## Open — owner decisions requested

### D5 — Push/CI auth (blocks M0 task 13)
`gh` CLI is not installed. Owner directed (2026-11-02): do NOT push tonight, do NOT open
PRs. Commit locally after every green task; write the CI workflow file and prove it by
running the exact same commands locally; mark "CI green on a PR" partial ("awaiting push auth").

## Recorded (no action needed now)

### D1 — Node.js version — RESOLVED (owner-approved 2026-11-02)
Owner decision: use the installed Node 24 LTS as an approved deviation; `engines.node`
is `>=22`; the Dockerfile uses `node:24-slim`.

### D2 — pnpm installation — RESOLVED
`corepack enable pnpm` failed (EPERM writing to `C:\Program Files\nodejs`), the approved
fallback `npm i -g pnpm` installed pnpm 12.16.1. Pinned in root `package.json`
`packageManager`.

### D3 — TypeScript line — RESOLVED
Pinned typescript 6.0.3 per owner decision. Verified compatible: tsc strict builds pass
and typescript-eslint 8.72.1 + eslint 10.14.0 lint clean (2026-11-02). If a future tool
rejects TS 6, fall back to the newest 5.x and record it here.

### D9 — pnpm build scripts for esbuild
pnpm's default policy ignored esbuild postinstall scripts, printing install errors.
esbuild functions via its platform binary packages either way, but for a clean,
reproducible install the postinstalls were allowed once with
`pnpm install --dangerously-allow-all-builds` (project-local effect: runs esbuild's own
postinstall; no other package in the tree has build scripts). `onlyBuiltDependencies:
[esbuild]` is recorded in `pnpm-workspace.yaml` for CI parity.

### D10 — Docker daemon started
Docker Desktop was launched once (owner-approved) and became ready in ~10 s (server
29.6.1). Postgres via docker compose is available for M0 integration tests.

### D11 — @playwright/cli installed locally, not globally
Owner safety rule: no global system changes except installing pnpm. `@playwright/cli`
therefore goes into the repo as a devDependency when browser checks start (M1) instead of
a global install; `playwright-cli install --skills` will run via `pnpm exec`.

### D4 — MCP SDK v2 packages verified
`@modelcontextprotocol/server` 2.4.0 and `@modelcontextprotocol/fastify` 2.0.1 exist on
npm — the prompt's SDK v2 requirement is satisfiable as written. `@modelcontextprotocol/sdk`
(1.32.2) is the banned v1 and will not be used. No `@modelcontextprotocol/client` package
exists; the agent-runner client (§14.3) will be resolved from the SDK v2 docs when M2 starts.
MCP work is M2 scope; nothing to do in M0.

### D6 — Postgres driver
Drizzle pairs with either `pg` 8.23.1 (node-postgres) or `postgres` 4.0.0 (postgres.js).
Choice: `pg` (the most common Drizzle/Postgres pairing, MIT). Recorded to avoid a silent swap.

### D7 — Workspace folder name
The workspace folder is still `C:\Users\T14S\BUP Hackathon`. The rename to "Internet Zero"
failed earlier because the open ZCode workspace held a Windows lock on it. Owner step:
close this workspace in ZCode, rename the folder, reopen from the new path. Purely cosmetic;
git and all tooling are unaffected.

### D8 — Interpretation: "playable from start to finish" in M0
Read as headless-playable via runtime actions (§19.1 M0 gate: "a test plays the tutorial
headless by actions only"), plus a persisting server. Browser UI playability is M1 per the
master prompt's milestone table and the owner's "no M1 features yet" instruction. Recorded
in docs/PLAN.md; flag if the owner intended otherwise.
