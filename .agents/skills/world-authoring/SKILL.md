---
name: world-authoring
description: Use when creating or editing a world in worlds/ or the content repo: folder layout, schemas, ids, hosts, facts, proofs, gates, reports, hints, events, and running iz build. Covers the iz/1 source format for INTRANET ZERO, the worlds/<id>/ tree, safe Markdown and markers, and the pnpm iz build loop until zero errors and zero warnings.
---

# World authoring (INTRANET ZERO iz/1)

You are editing or creating a world source. The compiler is the referee: nothing is valid
until `iz build` passes with zero errors AND zero warnings. The worked reference is
`worlds/tutorial` ("Lost and Found") — copy its shapes, not its content.

Privacy: NODE_17 and any flagship content go ONLY into the private content repo.
Never into `worlds/`, CI logs, issues, or PRs.

## 1. Folder layout

```text
worlds/<world-id>/
  world.yaml            metadata, hosts, entry, clock, hostSuffix
  people.yaml orgs.yaml identities.yaml
  facts.yaml beliefs.yaml statements.yaml proofs.yaml
  gates.yaml reports.yaml hints.yaml events.yaml
  services/
    forge/*.yaml        repo sources (id, owner, name, defaultBranch, readme, branches, commits, issues, users)
    mail/*.yaml         mailboxes with folders and messages
    archive/*.md        documents with YAML front matter
    terminal/fs/<host>/...   virtual file tree + fs.yaml (host metadata, motd, connectGate)
    forum/*.yaml        M2 only
  assets/               images, PDFs, audio
```

## 2. The build loop

```bash
pnpm iz build worlds/<id> --out dist/worlds --salt 0123456789abcdef0123456789abcdef   # root script: rebuilds compiler, then compiles
pnpm --filter @iz/compiler build && node packages/compiler/dist/cli.js build worlds/<id> --out dist/worlds --salt <32-hex>  # raw equivalent
```

- `--salt` is 32 hex chars. Omit it and the salt is random; always pass a fixed salt for
  reproducible bundles (answer hashes are `sha256(salt + ":" + gateOrSlotId + ":" + normalizedAnswer)`).
- `--report <path>` overrides where `report.json` lands (default: next to the bundle).
- Failure output is `check <n> | <file> | <id> | <message>`, one line per issue. Fix top-down.
- Done = exit 0, no `warnings:` block, and `report.json` shows a complete reachability tree.

Build checks (all must pass): 1 schema · 2 references resolve · 3 no contradicting facts ·
4 truthful statements match their fact · 5 every lie has reachable counter-evidence ·
6 every required fact has a reachable direct proof · 7 reachability (simulated player) ·
8 report slots map to facts · 9 three hint tiers per gate · 10 size limits ·
11 content safety · 12 hostSuffix is not a real TLD.

## 3. world.yaml and the hostSuffix rule

Fields: `id` (kebab, ≤32), `version` (semver), `format: iz/1`, `title`, `summary`,
`license: CC-BY-4.0` (literal for public worlds), `hostSuffix`, `clock {mode, epoch}`,
`hosts[] {host, service, title?, requires?}`, `entry: "host/path"`, `reports: [...]`.

- `hostSuffix` must NOT be a real TLD. Check 12 compares against the vendored IANA list in
  `packages/compiler/src/tlds.txt`; refresh it when starting a new world with
  `node packages/compiler/scripts/refresh-tlds.mjs`. Never use `.local` or any delegated TLD.
  Pick a 2–4 letter invented suffix (`pcp`, `n17`)
  and use it for every hostname and every email address in the world.
- Any real-looking URL that must appear in content uses `example.com`, `example.org` or `.invalid`.
- Hosts unlock via `requires: { gateSolved: g.id }`. The entry host must be unlocked at start.

## 4. Id prefixes and artifact ids

Every id matches `/^[a-z]+\.[a-z0-9][a-z0-9._-]{0,63}$/`. Prefixes:

| Prefix | Entity | Example |
| --- | --- | --- |
| `p.` | person | `p.rowan` |
| `o.` | org | `o.pinecone` |
| `id.` | account on a service | `id.odile-mail` |
| `f.` | fact | `f.rotation` |
| `a.` | artifact | `a.47e5a182...` |
| `g.` | gate | `g.first-commit` |
| `r.` | report | `r.who-holds` |
| `e.` | event | `e.lanternfish-post` |
| `h.` | reserved | (hosts are plain strings in world.yaml) |

Artifact ids are assigned by the service loaders — you must reference them exactly:

| Content | Artifact id | Source of the id |
| --- | --- | --- |
| forge repo | authored `id:` in repo.yaml | `a.office-scripts` |
| forge commit | `a.<40-hex sha>` | commit `sha` field |
| forge issue | `a.<repo-id>.issue.<number>` | derived |
| forge user | `a.user.<login-slug>` | derived |
| mail message | authored message `id:` | `a.m-hint` |
| archive document | authored front-matter `id:` | `a.doc-...` |
| terminal file | `a.<host>.<sanitized path>` | derived (`terminalFileId`) |

Artifact ids are globally unique; duplicates fail check 2. Read the loader source in
`packages/services/src/{forge,mail,archive,terminal}.ts` when unsure.

## 5. Facts are propositions

```yaml
- id: f.year
  proposition: { subject: o.pinecone, predicate: foundedYear, object: 2009 }
  required: true        # gates the win condition / report slots
  secrecy: hidden       # public | hidden | secret — never serialized to clients
  note: "author-only explanation of where this is proven"
```

- `subject` must be a person, org or identity id (check 2). `object` may be an id, string,
  number or boolean. Use stable predicates (`rotatedPrinterAdminPass`, `foundedYear`).
- `required: true` means check 6 demands a reachable direct proof — and house style demands
  corroboration (see §6). Facts that only report slots establish stay `required: false`.

## 6. Proofs: two independent sources per answer

For EVERY required fact, author two proofs in `proofs.yaml`: one `direct`, one
`corroborating`, on a DIFFERENT service. Check 6 enforces the direct one; corroboration is
the audit bar (no single point of failure).

```yaml
- fact: f.year
  artifacts: [a.1692bb4c3428499837c9b8d578d00462a48e4fca]   # forge: LICENSE copyright header
  strength: direct
- fact: f.year
  artifacts: [a.m-hint]                                     # mail: signature "est. 2009"
  strength: corroborating
```

Corroborating proofs may list several artifacts (e.g. a two-message mail thread).

## 7. Lies need reachable counter-evidence

Every `beliefs.yaml` entry with stance `lies_about` or `believes_false`, and every
`statements.yaml` entry with `truthful: false`, must have at least one REACHABLE artifact
that contradicts it (check 5); truthful statements must reference a fact with the same
proposition (check 4). Design rule: a lie is a puzzle — put its counter-evidence in a
different service than the lie.

## 8. Gates and reports

Four check kinds (`packages/schema/src/gates.ts`):

| Kind | Use | Notes |
| --- | --- | --- |
| `answer` | passphrase, name, date typed in | plaintext `answers` in SOURCE only; hashed at build. Default normalizers `["nfkc","lower","trim","collapse"]` |
| `report` | filed case report | `report: r.id`; group accepted only when ALL its slots are correct; the response reveals only which groups were accepted |
| `evidenceSet` | collect + link work | `mustCollect`, `mustLink {from,to,relation}` |
| `terminal` | read files on a node | `mustHaveRead` paths + `host`; reading a file emits `TerminalRead` |

- Gates have `requires` (Condition: `all/any/not/gateSolved/evidenceCollected/factEstablished/
  timeReached/teamSizeAtLeast`), `unlocks: []` (ids of hosts, artifacts, events, reports), `score` (default 100).
- Report slots: `type: identity|date|choice|text`, `fact` (what the slot establishes), `answers`.
  Slot ids are globally unique. `choice` slots must list `options` (3–4 plausible in-world
  wrong answers drawn from red herrings); `identity` slots accept the entity id OR its display
  name — list both (`answers: ["id.odile-mail", "Odile Brandt"]`); date slots: ISO dates.
- Pattern: every answer (gate answer or slot) is backed by a direct proof + corroboration in
  different services (§6). Two people may hold half the answer (tutorial's `biscuit2009`).
- Terminal `connect` passphrases: set `connectGate: g.<id>` in `services/terminal/fs.yaml`, gate `kind: answer`.

## 9. Hints: three tiers, costs 10 / 25 / 50

Check 9 fails without all three tiers per gate. Tier n unlocks only after tier n-1.
Write them as a ladder, not a spoiler cascade (tone/length reference: `worlds/tutorial/hints.yaml`):

1. `nudge` (cost 10) — where to look, never what to find.
2. `pointer` (cost 25) — names the artifact/shape of the answer.
3. `reveal` (cost 50) — states the answer or its exact construction.

## 10. Safe Markdown, custom markers and assets

All content is compiled at build (`packages/services/src/markdown.ts`) to a safe AST.

Allowed: paragraphs, headings, emphasis, strong, inline code, code blocks, lists,
tables, blockquotes, links, images, plus the three custom nodes below.
FORBIDDEN (build error): raw HTML, thematic breaks (`---`), footnotes, definitions,
strikethrough, event handlers, `javascript:`/`vbscript:` URLs, `data:text/html`.

- Links must point at hosts declared in `world.yaml` (any scheme is stripped). Image URLs
  must resolve to a world asset. Redacted text is excluded from search (`[REDACTED]` placeholder).
- Markers (inside inline text; left literal inside code; malformed markers fail the build):

```markdown
[[redaction:project codename|removable]]     <!-- revealed via "inspect layers" -->
[[redaction:—|fixed]]                        <!-- permanent blackout -->
[[signature:0xDEADBEEF|AA:BB:..:FF|valid|id.rowan-git]]
[[stamp:PINECONE PRINT CO. — INTERNAL NOTES]]
```

## 11. Assets

Put files in `assets/`; reference them by world-relative path in Markdown or front matter.
After build they are content-addressed by sha256 (referenced by that id in the bundle).
Limits (check 10): asset ≤ 10 MB, text artifact ≤ 256 KB, bundle ≤ 50 MB.

## 12. Events

```yaml
- id: e.lanternfish-post
  trigger: { after: { gateSolved: g.commits } }   # or { at: "<ISO world time>" }
  effects:
    - { deliverMail: { mailbox: id.player, message: a.mail-lanternfish-hello } }
    - { reveal: a.forge-issue-212 }
    - { addCommit: { repo: kestrel/relay-core, commit: a.commit-0007 } }
```
All referenced ids must exist (check 2). Delivered messages must already exist as artifacts.

## 13. Invented-name collision check

1. Search the web for `<name>` plus the world's context words (e.g. "Pinecone Print Co.",
   "Kestrel Lattice"). It must not match a real company, person or product in the same
   field; a distant, differently-branded namesake (e.g. Pinecone the vector DB) is fine.
2. Check the hostSuffix is not a real TLD (§3) and unique across worlds, and the name does
   not collide with another world's entities (players play multiple worlds). Note the result
   in the world's top-of-file comment. Never use real brands, real people, or names of real
   games/companies in the same domain.

## 14. Worked mini-example: add a side gate to the tutorial

Add "who supplies the toner?" as an answer gate (uses existing artifacts `a.m-toner` (mail)
and `a.office-scripts` (forge README)). Append to the named files:

```yaml
# facts.yaml
- id: f.toner-supplier
  proposition: { subject: o.pinecone, predicate: buysSuppliesFrom, object: o.cobble }
  required: false
# proofs.yaml — direct + corroborating on different services
- fact: f.toner-supplier
  artifacts: [a.m-toner]
  strength: direct
- fact: f.toner-supplier
  artifacts: [a.office-scripts]
  strength: corroborating
# gates.yaml
- id: g.toner
  title: "The Toner Trail"
  requires: { gateSolved: g.first-commit }
  check: { kind: answer, answers: ["Cobble Office Supply"] }
  score: 50
# hints.yaml — three tiers at costs 10/25/50, see section 9
```

Then run the build loop (§2); when it compiles clean, run the story-consistency-audit skill before merging.

## 15. Authoring checklist

- [ ] hostSuffix checked against a refreshed IANA list; emails use the world suffix
- [ ] Every id has the right prefix; artifact ids match the loader scheme exactly
- [ ] Every required fact: direct proof + corroborating proof in a different service
- [ ] Every lie/untruthful statement has reachable counter-evidence
- [ ] Every answer (gate or slot) derivable from two independent in-world sources
- [ ] Every gate has 3 hint tiers at costs 10/25/50; hint text matches the gate's normalizers
- [ ] Choice slots have 3–4 plausible wrong options; identity slots list id + display name
- [ ] No HTML/thematic breaks/footnotes in content; markers well-formed; invented names
      passed the collision check (no real companies/people/products)
- [ ] `pnpm iz build worlds/<id> --out dist/worlds --salt <32-hex>` exits 0, zero warnings
