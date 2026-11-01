---
name: fictional-service-development
description: Use when building or changing a simulated service (forge, mail, archive, terminal, forum): module contract, loaders, view models, visibility, collectibles, UI. Covers the ServiceModule contract in packages/services, artifact loaders, the safe AST renderer, and the required tests.
---

# Fictional service development (INTRANET ZERO)

You are building or changing one of the five simulated services: `forge`, `mail`,
`archive`, `terminal`, `forum`. Everything here lives in `packages/services` (loaders,
view logic), `packages/terminal` (interpreter) and `packages/ui` (shared components).
Game logic stays out of `apps/server` — it only adapts transport.

## 1. The ServiceModule contract

Frozen in `packages/services/src/context.ts`:

```ts
export interface ServiceModule {
  id: "forge" | "mail" | "archive" | "terminal" | "forum";
  load(source: unknown, ctx: LoadContext): Artifact[];   // build time
  routes: string[];                                       // in-game path patterns
  // view(bundle, state, host, path): ViewModel | NotFound   — arrives in M1
  // collectibles(view: ViewModel): Collectible[]            — arrives in M1
}
```

M0 ships only `id`, `load`, `routes`. Do NOT stub `view`/`collectibles` before M1; add them
in the milestone that needs them and note it in docs/DECISIONS.md.

`LoadContext = { world: WorldSource; assets: Map<string, AssetRecord> }` — `assets` is keyed
by BOTH the world-relative source path and the content-addressed sha256 id.

Helpers you must reuse (same file): `parseSource` (defensive Zod parse, throws `ServiceError`
with check 1), `resolveHost` (exactly one host per service — more than one is a build error
for forge/mail/archive; use `resolveHosts` for terminal), `identityIndex`, `entityIndex`,
`entityName`, `resolveAssetRef` (path or sha256 → sha256 id), `sanitizeIdFragment`,
`terminalFileId`. `ServiceError(message, check)` maps to compiler build checks (1 = schema,
2 = reference/shape).

## 2. Loaders create artifacts

Every piece of service content becomes an `Artifact`
(`packages/schema/src/artifacts.ts`):

```ts
{ id, host, path, kind, title, body, ast, meta, visibility?, collectible }
```

- `kind`: `repo | commit | issue | user | mail-message | mail-thread | archive-document |
  terminal-file | forum-post`. A new kind means editing the `ArtifactKind` enum in schema.
- `body` is the plain text for search: build it from `safeText(ast)` plus service-specific
  header lines (see mail: Subject/From/To/Cc/Date/headers then body).
- `ast` is the pre-rendered safe AST — compile every Markdown with
  `compileMarkdown(body, { allowedHosts, resolveAsset })` from `packages/services/src/markdown.ts`.
- `meta` is a `Record<string, string|number>`; serialize structured extras as JSON strings
  (attachments, redactions, headers) exactly like the existing loaders do.
- `collectible`: true for things players gather as evidence — forge commits, mail messages,
  archive documents; false for repo shells, user profiles, terminal files (current defaults).
- Ids: use the stable schemes — commit `a.<40-hex sha>`, issue `a.<repo-id>.issue.<n>`,
  user `a.user.<login>`, mail/archive authored `id:`, terminal `a.<host>.<sanitized path>`.
  Duplicate ids are a build error (check 2). Artifacts must be returned sorted by id.
- Parse the service source with a strictObject Zod schema via `parseSource`; never hand-roll
  field access on `unknown`.

## 3. Visibility filtering happens before view building

- The compiler (`packages/compiler/src/artifactize.ts`) derives `artifact.visibility` from
  gate `unlocks` (`{gateSolved: g.id}`), event `reveal` effects, and host `requires`
  conditions. Loaders do NOT set visibility themselves.
- The server calls `view()` only AFTER checking host reachability and artifact visibility
  for the team state. A ViewModel contains only visible data.
- Search (`packages/runtime`/server index): filter by the session's visibility set BEFORE
  ranking; never return counts that include invisible artifacts.
- Redacted text never enters `body` — `safeText` replaces redactions with `[REDACTED]`, so
  hidden content can't leak through search or MCP.

## 4. Collectibles and fragments

`Collectible = { artifactId, label, fragment? }` where `fragment` is
`{kind:"lines", from, to}` or `{kind:"range", start, end}` (rendered text) or
`{kind:"region", x, y, w, h}` (images). Collecting is idempotent per team + artifact +
fragment and produces an `EvidenceItem` with provenance `{host, path, service}`.
Collectible ids are artifact ids — never invent a second id space.

## 5. Safe AST renderer and UI

- The client renders `SafeNode` trees with React components (`@iz/schema` `safe-ast.ts`);
  allowlist only: paragraphs, headings, emphasis, strong, code/inlineCode, lists, tables,
  blockquotes, in-game links, asset images, `redaction`/`signature`/`stamp` custom nodes.
  Player-written text (claims, notes, posts) renders as plain text with line breaks — never
  Markdown.
- Shared kit in `packages/ui`: window chrome, design tokens, service skins that read as
  plausible 2010s web apps without copying real branding; the `Collect` button on every
  collectible; text-select + `C` to collect; "inspect layers" for removable redactions.
  Use the `frontend-design` and `web-design-guidelines` skills for any UI task.

## 6. Required tests (every service change)

| Test | Where | Must assert |
| --- | --- | --- |
| Loader unit tests | `packages/services/test/<service>.test.ts` | valid source → expected artifact ids/kinds/hosts; invalid source → `ServiceError` with the right check number; asset refs canonicalize; duplicate ids rejected |
| View per route | same file (M1+) | every `routes` pattern returns a ViewModel for a visible artifact; `NotFound` for unknown paths; locked artifacts return NotFound-shaped data that does NOT reveal existence |
| Leak test per locked artifact | `test/` integration | before solving the gating gate, no REST/WS/search/MCP response contains any substring > 12 chars of the locked artifact's body |
| Playwright smoke | `test/e2e/` | open the service in the in-game browser, collect one item, pass one gate through this service |

Run: `pnpm --filter @iz/services test` and the root `pnpm build && pnpm test`. Never report
a test passing that you did not watch pass.

## 7. Adding or changing a service — checklist

- [ ] Source schema (strictObject) added/updated in `packages/schema`, unknown keys rejected
- [ ] Loader uses `parseSource`, `resolveHost(s)`, `compileMarkdown`, `safeText`; ids follow §2
- [ ] `routes` lists every in-game path pattern; nothing routes to the real network
- [ ] Visibility derived by the compiler only; view filters before building (M1+)
- [ ] Collectibles stable across builds (no timestamp/id drift — bundles are hashed)
- [ ] Loader, view, leak and Playwright tests written and green
- [ ] `pnpm build && pnpm test` green; docs/STATUS.md ledger row updated
- [ ] No new imports of `child_process`, `vm`, `eval`, `Function`, `fs`, `net`, `http(s)`,
      `fetch` anywhere in runtime/services/terminal/mcp (import-scan test enforces)
