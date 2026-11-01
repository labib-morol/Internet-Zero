---
name: security-audit
description: Use before every milestone gate and on any change to terminal, services, mcp, auth, uploads or content rendering. Walks the section 16 requirement table with concrete test commands for INTRANET ZERO and records findings in docs/security/audit-<date>.md.
---

# Security audit (INTRANET ZERO)

Run before every milestone gate (M0/M1/M2) and on ANY change to `packages/terminal`,
`packages/services`, `packages/mcp`, auth, uploads or content rendering. Security rules
override convenience (master prompt section 0, rule 13). A failing row blocks the gate.

## 1. Automated sweeps (run all, paste summary lines)

```bash
pnpm build && pnpm test                 # everything below lives inside the suite
pnpm vitest run test/security-import-scan.spec.ts    # banned-import scan (runtime, services, terminal, mcp)
pnpm audit --prod                       # dependency advisories; triage every hit
npx gitleaks detect --source . -v       # secret scan; equivalent tool acceptable, note which
```

Also run the targeted suites when present: leak suite, payload corpora, rate-limit tests,
malicious-bundle fixtures (they are part of `pnpm test`; grep `test/` and `packages/*/test`
for them). A row with no test yet is a finding, not a pass.

## 2. Walk the requirement table

Every row is an acceptance criterion from section 16. Record pass/fail per row.

| # | Requirement | How this repo proves it |
| --- | --- | --- |
| 1 | No host command execution from game input | `test/security-import-scan.spec.ts` (bans `child_process`, `vm`, `fs`, `net`, `http(s)`, `worker_threads` and more in runtime/services/terminal/mcp) + terminal parser fuzz test |
| 2 | Locked artifacts never leave the server | Leak suite: for every gate in tutorial + fixture worlds, before solving, no REST/WS/search/MCP response contains any substring > 12 chars of a locked artifact body |
| 3 | Canon never leaves the server | Response-shape snapshot tests: no `facts`, `beliefs`, `proofs`, `statements`, `answerHash` keys anywhere a client can read |
| 4 | No cross-team / cross-user leakage | Two teams, two users each; assert isolation across every endpoint and WebSocket room |
| 5 | XSS | Payload corpus in world content and claims; compiler rejects (check 11) or renderer escapes |
| 6 | SSRF | No outbound HTTP modules (row 1 scan) + typed-in-game URL never triggers a network call (network-blocking stub test) |
| 7 | Path traversal | Asset ids are sha256 content hashes; corpus of `../`, percent-encoded and absolute paths rejected by asset serving |
| 8 | SQL injection | Drizzle parameters only; ESLint bans raw SQL outside migrations |
| 9 | Malicious world bundles | Crafted bundles (oversize, scripts, bad refs, cyclic gates, unknown keys) rejected by compiler and loader |
| 10 | Prompt injection against agents | Tool descriptions carry `MCP_FICTION_WARNING`; agent tokens have player rights only (mcp-integration skill §6) |
| 11 | Brute force | Rate-limit tests: answers/reports 10 attempts per rolling 10 min per team per gate, doubling wait up to 15 min; rejected attempts are events (survive restarts) |
| 12 | Denial of service | Body limit 256 KB REST, 64 KB WebSocket messages, 120 req/min per IP, terminal output 64 KB, command 1 KB |
| 13 | Secrets | `.env` gitignored; gitleaks in CI; secrets never logged; no secrets in bundles |
| 14 | Headers | Strict CSP (no inline scripts, self + asset origin), HSTS in production, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'` |

## 3. Manual review checklist (rows 1, 5, 6, 9, 13, 14 especially)

- [ ] CSP/headers actually set on every response in `apps/server` (inspect with
      `curl -sI http://localhost:<port>/` against a running dev or docker server)
- [ ] No new `eval`/`Function`/dynamic `import()` on user-influenced strings anywhere
- [ ] Player text paths (claims, notes, terminal input) render as plain text; no new Markdown
      pipeline added outside `compileMarkdown`
- [ ] New endpoints: body size limit, auth check, per-team `WHERE teamId` clause, no raw SQL
- [ ] New dependencies: license checked, exact version pinned, no new network capability in
      runtime/services/terminal/mcp
- [ ] Logs: no player text, tokens or cookies at `info` (grep pino call sites)
- [ ] Compiler still rejects: oversize content, unknown keys, cyclic gates, `javascript:`
      URLs, HTML in content (rerun the invalid-fixture worlds)
- [ ] `.env`, `dist/`, bundles checked out of git; `git ls-files | grep -i env` clean

## 4. Record findings — docs/security/audit-<date>.md

Create `docs/security/` if missing. Template:

```markdown
# Security audit — <YYYY-MM-DD>

Milestone: <M0|M1|M2> · HEAD: <commit sha> · Auditor: <who>

## Commands run
- pnpm build && pnpm test — <summary line>
- pnpm vitest run test/security-import-scan.spec.ts — <summary line>
- pnpm audit --prod — <hit count and triage>
- gitleaks detect — <findings or "none">

## Requirement table
| # | Requirement | Result | Evidence (test name / command / file) |
| --- | --- | --- | --- |
| 1 | No host command execution | pass | security-import-scan.spec.ts (17 banned modules) |
| 2 | Locked artifacts | FAIL | leak test missing for ws search path — finding F1 |
| ... |

## Findings
| ID | Severity | Requirement # | Finding | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| F1 | blocker | 2 | ... | add ws leak test | open |
| F2 | minor | 14 | Referrer-Policy missing on /assets | set in server bootstrap | fixed <sha> |

## Sign-off
Gate may pass only with zero open blockers. Majors need an owner-acknowledged issue.
```

## 5. After the audit

- Fix blockers before the milestone gate; rerun section 1 and the failing rows.
- Update `docs/security/threat-model.md` when a control or the table itself changes.
- Update the docs/STATUS.md ledger row for "security audit" with the file name and date.
- On any change to terminal/services/mcp/auth/uploads/rendering before the next scheduled
  audit: re-run rows 1, 2, 3, 5, 10 at minimum.
