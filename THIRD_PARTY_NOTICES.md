# THIRD_PARTY_NOTICES

Third-party coding-agent skills vendored into `.agents/skills/` (master prompt §4.1).
Recorded 2026-11-02. Re-verify upstream names/paths when updating.

| Skill folder(s) | Source | Commit | License |
| --- | --- | --- | --- |
| writing-plans, executing-plans, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review | https://github.com/obra/superpowers (`skills/<name>`) | 2ce8aa1 (2026-10-21) | MIT — Copyright (c) 2025 Jesse Vincent (repo `LICENSE`) |
| webapp-testing, mcp-builder, frontend-design | https://github.com/anthropics/skills (`skills/<name>`, sparse checkout) | ca45fc4 (2026-10-28) | Apache-2.0 (each skill folder ships `LICENSE.txt`) |
| web-design-guidelines | https://github.com/vercel-labs/agent-skills (`skills/web-design-guidelines`) | 1a2c79d (2026-10-27) | Apache-2.0 (repo `LICENSE`) |

The six project skills under `.agents/skills/` (`world-authoring`,
`story-consistency-audit`, `blind-playtesting`, `fictional-service-development`,
`mcp-integration`, `security-audit`) are original to this repository (Apache-2.0,
same as the engine) and are not third-party.

Runtime dependencies and their licenses are pinned in `package.json` files and the
pnpm lockfile; notable non-MIT entries: drizzle-orm (Apache-2.0),
@playwright/test (Apache-2.0), `yaml` (ISC), `postgres` driver not used (see
DECISIONS D6).
