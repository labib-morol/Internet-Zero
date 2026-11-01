# iz/1 source file reference

Exact field names as validated by `packages/schema/src/*.ts` (Zod 4, strictObject:
unknown keys are errors). Point of truth is the schema; this file is a reading aid.

## world.yaml (`WorldYaml`)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | kebab string, ≤32 | world id, e.g. `tutorial` |
| `version` | semver string | `1.0.0` |
| `format` | literal | `iz/1` |
| `title`, `summary` | non-empty strings | |
| `license` | literal | `CC-BY-4.0` (public worlds) |
| `hostSuffix` | `^[a-z][a-z0-9-]{1,30}$` | must not be a real TLD (check 12) |
| `clock` | `{mode: session\|global, epoch: ISO+offset}` | |
| `hosts[]` | `{host, service, title?, requires?}` | service: forge\|mail\|archive\|terminal\|forum |
| `entry` | string | `"<host>/<path>"`, must resolve to an artifact (check 2) |
| `reports` | array of report ids, min 1 | |

## people.yaml / orgs.yaml / identities.yaml

- Person: `id, displayName, role?, bio?`
- Org: `id, name, kind?, description?`
- Identity: `id, service, login, displayName, person? | org?, deleted (default false), meta?`

## facts.yaml (`Fact`)

`id, proposition {subject (Id), predicate (string), object (Id|string|number|boolean)},
validFrom?, validTo? (ISO+offset), required (default false), secrecy (public|hidden|secret,
default hidden), note?`

## beliefs.yaml (`Belief`)

`holder (Id), proposition, stance (knows|believes|believes_false|suspects|hides|lies_about),
since?`

## statements.yaml (`Statement`)

`artifact (Id), speaker (Id), proposition, truthful (boolean), fact? (required when truthful)`

## proofs.yaml (`Proof`)

`fact (Id), artifacts (Id[], min 1), strength (direct|corroborating)`

## gates.yaml (`Gate`)

`id, title, requires? (Condition), check, unlocks (Id[], default []), score (int, default 100)`

`check` is one of:

- `answer`: `{kind, normalize (nfkc|lower|trim|collapse|stripPunct, default nfkc,lower,trim,collapse), answers (string[], min 1)}`
- `report`: `{kind, report (Id)}`
- `evidenceSet`: `{kind, mustCollect (Id[]), mustLink ({from, to, relation}[], default [])}`
- `terminal`: `{kind, mustHaveRead (string[], min 1), host (string)}`

Condition: `all[] | any[] | not | gateSolved | evidenceCollected | factEstablished | timeReached | teamSizeAtLeast` — recursive.

## reports.yaml (`Report`)

`id, title, groups[] {id, slots[]}`; slot: `id (globally unique), label, type
(identity|date|choice|text), options? (required for choice), fact (Id), answers (string[], min 1)`.
Per-type normalization at grading (`SlotNormalizers`): identity/choice/text use
`nfkc,lower,trim,collapse`; date uses `nfkc,trim`.

## hints.yaml (`Hint`)

`gate (Id), tier (1|2|3), text (non-empty), cost (int ≥ 0)`. House costs: 10 / 25 / 50.

## events.yaml (`EventDef`)

`id, trigger ({after: {gateSolved}} | {at: ISO world time}), effects[]`
Effects: `deliverMail {mailbox, message}` · `reveal {artifact}` · `addCommit {repo, commit}`.

## services/forge/*.yaml

`id (artifact id of the repo), owner, name, description, defaultBranch, readme (Markdown),
branches[], users[] {login, name?, bio?}, commits[], issues[]`
Commit: `sha (40 hex), parents[], author {name, email, identity?}, committer {name, email, host},
date (ISO), message, signature? {keyId, fingerprint, valid, signer (Id)}, changes[]
({kind: add|modify|delete, path, before?, after?}, min 1)`.

## services/mail/*.yaml

`mailboxes[] {id, owner, folders/messages}`; message: `id, folder (inbox|sent|drafts|archive),
from (identity Id), to[], cc[], date, subject, body (Markdown), attachments[]
({asset, filename, redactions}), thread?, headers?`. Attachment redactions:
`{kind: redaction, text, removable}` — removable ones are revealed only via "inspect layers".

## services/archive/*.md

YAML front matter: `id, title, type (report|letter|contract|listing|keyserver-dump|abstract),
date, source, assets[], redactions[], meta {}`; body is Markdown.

## services/terminal/

`fs/<host>/<path>` is the virtual file tree (plain text files). `fs.yaml`:
`hosts[] {host, motd?, connectGate?}` — connectGate is the answer gate guarding `connect`.

## Build checks 1–12 (packages/compiler/src/checks.ts)

1. Schema validation (file + line in error) · 2. All references resolve · 3. No contradicting
facts (same subject+predicate, different objects, overlapping validity) · 4. Truthful
statements match their fact's proposition · 5. Lies/untruthful statements have a reachable
contradicting artifact · 6. Required facts have a reachable direct proof · 7. Reachability
simulation from entry · 8. Report slots map to facts; slot answers match the fact object ·
9. Three hint tiers per gate · 10. Sizes (bundle 50 MB, asset 10 MB, text artifact 256 KB) ·
11. Content safety (no HTML/scripts/handlers/js: URLs) · 12. hostSuffix not a real TLD.
