# Threat model (master prompt §16)

Last reviewed: 2026-11-03. Auditor: intranet-zero-dev (agent run). Evidence pointers
reference tests that exist in the repo at commit `1067d03` or later — verify with
`pnpm test` before citing externally.

## Requirement table

| # | Requirement | Control | Evidence |
| --- | --- | --- | --- |
| 1 | No host command execution from game input | ESLint + import-scan ban `child_process`/`vm`/`eval`/`Function` in runtime, services, terminal, mcp; terminal is a pure reducer over world files | `test/security-import-scan.spec.ts`, `packages/terminal/test/security.test.ts`, `packages/terminal/test/terminal.test.ts` |
| 2 | Locked artifacts never leave the server | Visibility filter before every view/search/MCP projection; gated terminal files hidden until connectGate solved | `test/leak-suite.spec.ts`, `apps/server/test/terminal-visibility.test.ts`, `apps/server/test/visibility-m1.test.ts`, `apps/server/test/mcp-permissions.test.ts` |
| 3 | Canon never leaves the server | Bundle `canon` section is server-only; answer hashes replace plaintext at compile; response-shape assertions | `test/leak-suite.spec.ts`, `apps/server/test/security.test.ts`, `apps/server/test/mcp-permissions.test.ts` |
| 4 | No cross-team/user leakage | Team-scoped repositories; WS team rooms; isolation tests; other users' private claims filtered from `/api/state`; private claims rejected on the shared stream | `apps/server/test/isolation.test.ts`, `apps/server/test/notes-m1.test.ts`, `apps/server/test/terminal-visibility.test.ts` |
| 5 | XSS | Markdown allowlist compiled to safe AST at build; renderer escapes; compiler rejects HTML/event handlers/`javascript:` | `packages/services/test/markdown.test.ts`, `packages/ui/test/safe-ast.test.tsx`, compiler check 11 |
| 6 | SSRF | No network modules in game-logic packages (row 1); in-game URLs resolved only by the router; page-side code never touches `window.location` | `test/security-import-scan.spec.ts`, `apps/web/test/browser.test.tsx` |
| 7 | Path traversal | Asset ids are sha256 with strict regex; `../`/encoded/absolute paths rejected; overlay redirections relative-only | `apps/server/test/assets-m1.test.ts`, `packages/runtime/test/integrity.test.ts`, `packages/terminal/test/terminal.test.ts` |
| 8 | SQL injection | Drizzle query builder only; no raw SQL outside migrations | `apps/server/src/db/**`, review |
| 9 | Malicious world bundles | Loader verifies integrity hash, dangling references, connectGate/completion markers, asset size/type, AST size, gate cycles; compiler checks 1–12 | `apps/server/test/bundle-integrity.test.ts`, `apps/server/test/bundle-references.test.ts`, `packages/compiler/test/invalid-worlds.test.ts` |
| 10 | Prompt injection against agents | Fiction warning in every tool description; agent tokens are player-rights only | `apps/server/test/mcp-m2.test.ts`, `packages/mcp/src/tools.ts` |
| 11 | Brute force | 10 attempts / rolling 10 min per team per gate, doubling wait capped 15 min; rejections are events (survive restart) | `packages/runtime/test/runtime.test.ts`, `apps/server/test/security.test.ts` |
| 12 | Denial of service | 256 KB REST body, 64 KB WS message, 120 req/min per IP, 64 KB terminal output, 1 KB command, 20 actions/s WS | `apps/server/test/security.test.ts`, `apps/server/test/ws.test.ts` |
| 13 | Secrets | `.env` git-ignored + CI guard; gitleaks in CI; tokens hashed; logs redact auth headers | `.github/workflows/ci.yml`, `apps/server/src/game.ts` logging |
| 14 | Headers | Strict CSP (no inline scripts), HSTS for https origins, nosniff, no-referrer, frame-ancestors none | `apps/server/test/security.test.ts`, `apps/server/src/security.ts` |

## In-game terminal specifics

- grep patterns are bounded (no repetition/groups/alternation → no ReDoS);
- overlay writes are relative-only, ≤ 64 KB/file, ≤ 100 files;
- overlay reads never emit `TerminalRead` (world-file gates cannot be satisfied by
  player-written files);
- fixed-redaction text never reaches any client projection.

## Acceptance runs

- Accessibility: `test/e2e/tutorial.spec.ts` runs axe (WCAG 2.0/2.1/2.2 A+AA) on
  landing, desktop, case file and compact mode — zero serious/critical findings.
- Keyboard-only: same spec completes the tutorial without pointer events.
- Mobile: 390×844 compact shell with app switcher.

## Known gaps (honest)

Updated 2026-11-09 (production-readiness audit, docs/security/audit-2026-11-09.md):

- Teams, GitHub sign-in, the forum and the Render blueprint now EXIST; the 2026-11-03
  note above is historical. Remaining deployment acceptance (real HTTPS host, OAuth
  credentials, staging persistence, backup/restore) is owner-gated and pending.
- Deployment is SINGLE-REPLICA by design: WS rooms, team locks, rate-limit buckets and
  MCP counters are process-local. Horizontal scaling or rolling overlap is not supported
  until events fan-out and admission control are shared across processes.
- The CSP allows `style-src 'unsafe-inline'` (needed for window geometry); no inline
  scripts are permitted.
- Cookie-authenticated mutations require a matching Origin (browsers always send one on
  cross-site POSTs); non-browser clients authenticate with explicit Bearer tokens.
- `pnpm audit --prod --audit-level high` is clean (the two moderate transitive
  advisories were resolved by updating @fastify/static).
- Backup/restore drills and outage exercises have not been run against staging
  infrastructure; the local battery proves code behavior only.
