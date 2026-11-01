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

### D9 — pnpm build scripts for esbuild — RESOLVED
pnpm 12's policy ignores postinstall scripts for packages not explicitly allowed and
hard-errors on fresh installs. `onlyBuiltDependencies` did NOT satisfy pnpm 12.16.1
(tested empirically); the mechanism that works is `allowBuilds: {esbuild: true}` in
`pnpm-workspace.yaml` (equivalent to `pnpm approve-builds --all`). esbuild is the only
package in the tree with build scripts; it is a required, trusted tool of the
tsx/drizzle-kit/vitest toolchain. Docker and CI use a plain `pnpm install
--frozen-lockfile`, which is now clean.

### D10 — Docker daemon started
Docker Desktop was launched once (owner-approved) and became ready in ~10 s (server
29.6.1). Postgres via docker compose is available for M0 integration tests.

### D12 — Docker runtime stage copies the full workspace node_modules
`pnpm deploy --prod` was deferred: pnpm 12's deploy flow needs extra workspace
configuration and the slim-runtime optimization is deferred to the M2 deploy task
(master prompt §17.3). The M0 image is functional (multi-stage, non-root, compiled
worlds baked in, 589 MB) but not yet minimal.

### D13 — RuntimeState over the wire (server integration)
JSON cannot carry `Set`, so the server serializes `RuntimeState.unlocked` and
`.firedEvents` as sorted arrays (apps/server/src/state-wire.ts) and the response is
validated against the frozen schema before conversion. Clients wrap them in `new Set()`.
Recorded per §19.3's contract-change rule: the schema itself is unchanged.

### D14 — Event store identity column
`events.id` uses `GENERATED ALWAYS AS IDENTITY` (bigint) instead of `bigserial` —
same effect, stricter; §15's `id bigserial` intent preserved.

### D15 — Recovery codes are reusable credentials
"Shown once" is implemented as display-once (users keep the code like a password and
can resume with it repeatedly). api.ts's "only way back into a guest account" reading.

### D16 — packages/terminal exec context parameter
§19.3 freezes `exec(fs, overlay, cwd, line)`; the implementation adds an optional
5th parameter `ctx` ({host, user, now, forge?, verify?}) needed to emit schema-valid
`TerminalRead`/`TerminalOverlayWrite` events (which require `host`) and to serve
`whoami`/`date`/`log`/`verify`. Backwards compatible with the frozen 4-arg signature.
`connect` is intercepted by the server (gate-checked host operation, not a filesystem
one); `clear`/`history`/`logout` are accepted client-side no-ops.

### D18 — view() takes an injected `now`
§10's view signature is `view(bundle, state, host, path)`; the implementation adds a
5th parameter `now: string` so time-based visibility conditions are evaluated with the
server's clock (the same pattern as the runtime's injected Clock). Recorded per §19.3's
contract-change rule.

### D19 — WorldBundle carries structured forge/mail sources
View building needs structured data (commit changes, mail metadata) that artifact
bodies/ASTs cannot carry losslessly. WorldBundle gains server-side `forge: ForgeRepo[]`
and `mailboxes: Mailbox[]` (with `.default([])` for compatibility). These sections are
world content, not canon, and are still never sent raw to clients — only projected into
view models.
### D17 — Postgres 18 volume layout + compose context bug on this machine
Postgres 18 images expect the volume at `/var/lib/postgresql` (single mount); the
legacy `.../data` mount makes the container exit. Separately, `docker compose` v5.2
on this Windows machine fails to resolve the build context when the repo path
contains a space ("GetFileAttributesEx C:\Users\T14S\infra" — path mangling) even
with absolute `-f`/short paths; plain `docker build` is unaffected. Workaround
committed as `infra/compose.prebuilt.yml` (build with docker build, run compose with
the prebuilt image). Revisit when compose fixes the resolution.

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
