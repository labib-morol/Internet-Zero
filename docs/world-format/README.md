# World format — `iz/1`

A world is a folder of YAML files plus per-service content (§6.1 of the master
prompt). `iz build worlds/<id>` compiles it into a single validated JSON bundle.
Every id is lowercase with a type prefix (`p.` person, `o.` organization,
`id.` identity, `f.` fact, `a.` artifact, `g.` gate, `r.` report, `e.` event).

## Folder layout

```
worlds/<id>/
  world.yaml            metadata, hosts, entry point, clock
  people.yaml           fictional people
  orgs.yaml             fictional organizations
  identities.yaml       accounts on services, linked to people/orgs
  facts.yaml            canonical facts (truth — server-only after compile)
  beliefs.yaml          what characters know, believe, hide or lie about
  statements.yaml       claims made by artifacts, linked to facts
  proofs.yaml           which artifacts prove which facts
  gates.yaml            puzzles and progression
  reports.yaml          case report definitions
  hints.yaml            three tiered hints per gate (costs 10/25/50)
  events.yaml           timed or triggered world events
  services/
    forge/*.yaml        repos, commits, issues, users
    mail/*.yaml         mailboxes and threads
    archive/*.md        documents with YAML front matter
    terminal/fs.yaml    host metadata; files under fs/<host>/**
    forum/*.yaml        GHOSTBOARD boards, threads, posts
  assets/               images, PDFs, audio — content-addressed at build
```

## Authoritative reference

The JSON Schema documents under `schema/` are **generated from the Zod source of
truth** (`packages/schema`) — regenerate with:

```bash
node --input-type=module -e "import { worldFormatJsonSchema } from './packages/schema/dist/index.js'; import { writeFileSync } from 'node:fs'; for (const [n, s] of Object.entries(worldFormatJsonSchema())) writeFileSync('docs/world-format/schema/' + n + '.json', JSON.stringify(s, null, 2));"
```

| File | Covers |
| --- | --- |
| `schema/WorldYaml.json` | world.yaml: id, version, format, license, hostSuffix, clock, hosts, entry, reports |
| `schema/WorldSource.json` | the aggregate of all source files |
| `schema/Fact.json` | propositions: subject/predicate/object + validity, secrecy |
| `schema/Gate.json` | answer / report / evidenceSet / terminal checks, unlocks, score |
| `schema/Report.json` | case-report groups and slots (identity/date/choice/text) |

Unknown keys are always errors. The full field reference lives in
`.agents/skills/world-authoring/references/source-files.md`.

## Build checks

`iz build` fails on any of: schema violations, dangling references, contradicting
facts, truthful statements without matching facts, lies without reachable
counter-evidence, required facts without direct proofs, gate cycles, report slots
not matching facts, missing hint tiers, size limits, unsafe content (HTML/scripts/
`javascript:`), and hostSuffix colliding with a real TLD. Plaintext answers never
reach the bundle — they are replaced by salted hashes.

## Write your first world

1. Copy the tutorial: `cp -r worlds/tutorial worlds/my-first-case`.
2. Rename the world: edit `world.yaml` — new `id`, keep `format: iz/1` and
   `license: CC-BY-4.0`. Change `hostSuffix` to a made-up suffix that is **not**
   a real TLD (the build checks it against the IANA list).
3. Rewrite the content: people, the forge repo, mail threads, the terminal files.
   Every question a gate asks must be answerable from at least two independent
   in-world sources, and every required fact needs a direct proof plus a
   corroborating one from a *different* service.
4. Build until zero errors:

```bash
pnpm run worlds:build                                   # tutorial
pnpm iz build worlds/my-first-case --salt 0123456789abcdef0123456789abcdef
```

5. Playtest headless: point `test/m0-playthrough.spec.ts` at your bundle, or use
   the oracle (`tools/benchmark.ts` pattern) and the `blind-playtesting` skill.

Rules that keep worlds fair and safe: no real companies or people, no outside
knowledge required beyond common sense, every step has a hint path, and no
plaintext answers anywhere a client could reach (the compiler enforces this by
hashing).
