import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYamlText } from "yaml";
import {
  ArchiveDocMeta,
  Belief,
  EventDef,
  Fact,
  ForgeRepo,
  Gate,
  Hint,
  Identity,
  Mailbox,
  Org,
  Person,
  Proof,
  Report,
  Statement,
  TerminalFs,
  WorldYaml,
  ForumSource,
  type ForumBoard,
} from "@iz/schema";
import type {
  ArchiveDocMeta as ArchiveDocMetaT,
  EventDef as EventDefT,
  Identity as IdentityT,
  Belief as BeliefT,
  Fact as FactT,
  Gate as GateT,
  Hint as HintT,
  Org as OrgT,
  Person as PersonT,
  Proof as ProofT,
  Report as ReportT,
  Statement as StatementT,
  TerminalFs as TerminalFsT,
  WorldYaml as WorldYamlT,
} from "@iz/schema";
import { BuildError, type BuildIssue, sortIssues } from "./errors.js";

/**
 * Loads and schema-validates every world source file (build check 1).
 * File layout: master prompt section 6.1. Optional files default to empty
 * arrays; world.yaml is required.
 */

export type StringRef = { file: string; path: string; value: string };

export type ForgeFile = { file: string; repo: ForgeRepo };
export type MailFile = { file: string; mailbox: Mailbox };
export type ForumFile = { file: string; boards: ForumBoard[] };
export type ArchiveFile = { file: string; meta: ArchiveDocMetaT; body: string; markdown: string };
export type TerminalFile = { host: string; path: string; text: string };

export type WorldSourceFiles = {
  dir: string;
  world: WorldYamlT;
  /** All strings from every YAML source file, for the content-safety scan. */
  strings: StringRef[];
  people: PersonT[];
  orgs: OrgT[];
  identities: IdentityT[];
  facts: FactT[];
  beliefs: BeliefT[];
  statements: StatementT[];
  proofs: ProofT[];
  gates: GateT[];
  reports: ReportT[];
  hints: HintT[];
  events: EventDefT[];
  forge: ForgeFile[];
  mail: MailFile[];
  archive: ArchiveFile[];
  forum: ForumFile[];
  terminalFs: TerminalFsT;
  terminalFiles: TerminalFile[];
};

export class IssueCollector {
  readonly issues: BuildIssue[] = [];

  add(issue: BuildIssue): void {
    this.issues.push(issue);
  }

  schema(file: string, error: unknown, what: string): void {
    if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues: unknown }).issues)) {
      const zodError = error as { issues: Array<{ path: PropertyKey[]; message: string }> };
      for (const issue of zodError.issues.slice(0, 20)) {
        this.add({
          check: 1,
          file,
          message: `${what}: ${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`,
        });
      }
      return;
    }
    this.add({ check: 1, file, message: `${what}: ${(error as Error).message}` });
  }

  throwIfAny(): void {
    if (this.issues.length > 0) throw new BuildError(sortIssues(this.issues));
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Collects every string in a parsed YAML value so the safety scan can walk it. */
export function collectStrings(value: unknown, file: string, base: string, out: StringRef[]): void {
  if (typeof value === "string") {
    out.push({ file, path: base, value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, file, `${base}[${index}]`, out));
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) collectStrings(item, file, base.length === 0 ? key : `${base}.${key}`, out);
  }
}

type YamlFile = { file: string; data: unknown; strings: StringRef[] };

/** Parses one YAML file; YAML syntax errors are check-1 issues with position info in the message. */
async function loadYaml(collector: IssueCollector, dir: string, file: string): Promise<YamlFile | null> {
  const text = await readText(join(dir, file));
  if (text === null) return null;
  let data: unknown;
  try {
    data = parseYamlText(text);
  } catch (error) {
    collector.add({ check: 1, file, message: `YAML syntax error: ${(error as Error).message}` });
    return null;
  }
  const strings: StringRef[] = [];
  collectStrings(data, file, "", strings);
  return { file, data, strings };
}

interface ZodLike<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

async function loadYamlArray<T>(collector: IssueCollector, dir: string, file: string, schema: ZodLike<T>, what: string): Promise<T[]> {
  const parsed = await loadYaml(collector, dir, file);
  if (parsed === null) return [];
  if (!Array.isArray(parsed.data)) {
    collector.add({ check: 1, file, message: `${what}: expected an array of entries` });
    return [];
  }
  const result: T[] = [];
  parsed.data.forEach((entry, index) => {
    const checked = schema.safeParse(entry);
    if (!checked.success) {
      collector.schema(file, checked.error, `${what}[${index}]`);
      return;
    }
    result.push(checked.data);
  });
  return result;
}

/** Splits a markdown file with YAML front matter into meta + body (check 1 on both). */
function splitFrontMatter(file: string, markdown: string, collector: IssueCollector): { meta: unknown; body: string } | null {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---")) {
    collector.add({ check: 1, file, message: "archive document must start with a YAML front matter block (---)" });
    return null;
  }
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) {
    collector.add({ check: 1, file, message: "archive document front matter is not closed (missing --- line)" });
    return null;
  }
  const front = normalized.slice(3, end).replace(/^\n/, "");
  const body = normalized.slice(end + 4).replace(/^\n/, "");
  let meta: unknown;
  try {
    meta = parseYamlText(front);
  } catch (error) {
    collector.add({ check: 1, file, message: `front matter YAML syntax error: ${(error as Error).message}` });
    return null;
  }
  return { meta, body };
}

async function listFiles(dir: string, extensions: string[]): Promise<string[]> {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Service files may hold one object or an array of objects; normalize to entries. */
function toEntries(data: unknown): Array<{ index: number; value: unknown }> {
  if (Array.isArray(data)) return data.map((value, index) => ({ index, value }));
  return [{ index: 0, value: data }]; // let zod produce the check-1 error for non-objects
}

/** Walks services/terminal/fs/<host>/** and returns one entry per text file. */
async function loadTerminalFiles(collector: IssueCollector, dir: string): Promise<TerminalFile[]> {
  const fsRoot = join(dir, "services", "terminal", "fs");
  if (!(await exists(fsRoot))) return [];
  const files: TerminalFile[] = [];
  const walk = async (relative: string[]): Promise<void> => {
    const current = join(fsRoot, ...relative);
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = [...relative, entry.name];
      if (entry.isDirectory()) {
        await walk(next);
      } else if (entry.isFile()) {
        if (relative.length === 0) {
          collector.add({
            check: 1,
            file: `services/terminal/fs/${entry.name}`,
            message: "terminal files must live under a host directory: services/terminal/fs/<host>/...",
          });
          continue;
        }
        const text = await readFile(join(fsRoot, ...next), "utf8");
        files.push({ host: relative[0]!, path: next.slice(1).join("/"), text });
      }
    }
  };
  await walk([]);
  return files;
}

export async function loadWorldSource(dir: string): Promise<WorldSourceFiles> {
  const collector = new IssueCollector();

  const worldParsed = await loadYaml(collector, dir, "world.yaml");
  if (worldParsed === null) {
    collector.add({ check: 1, file: "world.yaml", message: "world.yaml is required" });
    collector.throwIfAny();
  }
  const worldChecked = WorldYaml.safeParse(worldParsed!.data);
  if (!worldChecked.success) collector.schema("world.yaml", worldChecked.error, "world");
  collector.throwIfAny();
  const world = worldChecked.data!;

  const strings: StringRef[] = [...worldParsed!.strings];

  const people = await loadYamlArray(collector, dir, "people.yaml", Person, "person");
  const orgs = await loadYamlArray(collector, dir, "orgs.yaml", Org, "org");
  const identities = await loadYamlArray(collector, dir, "identities.yaml", Identity, "identity");
  const facts = await loadYamlArray(collector, dir, "facts.yaml", Fact, "fact");
  const beliefs = await loadYamlArray(collector, dir, "beliefs.yaml", Belief, "belief");
  const statements = await loadYamlArray(collector, dir, "statements.yaml", Statement, "statement");
  const proofs = await loadYamlArray(collector, dir, "proofs.yaml", Proof, "proof");
  const gates = await loadYamlArray(collector, dir, "gates.yaml", Gate, "gate");
  const reports = await loadYamlArray(collector, dir, "reports.yaml", Report, "report");
  const hints = await loadYamlArray(collector, dir, "hints.yaml", Hint, "hint");
  const events = await loadYamlArray(collector, dir, "events.yaml", EventDef, "event");

  for (const file of [
    "people.yaml",
    "orgs.yaml",
    "identities.yaml",
    "facts.yaml",
    "beliefs.yaml",
    "statements.yaml",
    "proofs.yaml",
    "gates.yaml",
    "reports.yaml",
    "hints.yaml",
    "events.yaml",
  ]) {
    const parsed = await loadYaml(collector, dir, file);
    if (parsed !== null) strings.push(...parsed.strings);
  }

  // services/forge/*.yaml — one repo per file (an array of repos is also accepted).
  const forge: ForgeFile[] = [];
  for (const name of await listFiles(join(dir, "services", "forge"), [".yaml", ".yml"])) {
    const file = `services/forge/${name}`;
    const parsed = await loadYaml(collector, dir, file);
    if (parsed === null) continue;
    strings.push(...parsed.strings);
    for (const [index, repo] of toEntries(parsed.data).entries()) {
      const checked = ForgeRepo.safeParse(repo.value);
      if (!checked.success) {
        collector.schema(file, checked.error, `repo[${index}]`);
        continue;
      }
      forge.push({ file, repo: checked.data });
    }
  }

  // services/mail/*.yaml — one mailbox per file (an array of mailboxes is also accepted).
  const mail: MailFile[] = [];
  for (const name of await listFiles(join(dir, "services", "mail"), [".yaml", ".yml"])) {
    const file = `services/mail/${name}`;
    const parsed = await loadYaml(collector, dir, file);
    if (parsed === null) continue;
    strings.push(...parsed.strings);
    for (const [index, mailbox] of toEntries(parsed.data).entries()) {
      const checked = Mailbox.safeParse(mailbox.value);
      if (!checked.success) {
        collector.schema(file, checked.error, `mailbox[${index}]`);
        continue;
      }
      mail.push({ file, mailbox: checked.data });
    }
  }

  // services/archive/*.md — front matter + markdown body.
  const archive: ArchiveFile[] = [];
  for (const name of await listFiles(join(dir, "services", "archive"), [".md"])) {
    const file = `services/archive/${name}`;
    const markdown = await readText(join(dir, "services", "archive", name));
    if (markdown === null) continue;
    const split = splitFrontMatter(file, markdown, collector);
    if (split === null) continue;
    collectStrings(split.meta, file, "front", strings);
    strings.push({ file, path: "body", value: split.body });
    const checked = ArchiveDocMeta.safeParse(split.meta);
    if (!checked.success) {
      collector.schema(file, checked.error, "front matter");
      continue;
    }
    archive.push({ file, meta: checked.data, body: split.body, markdown });
  }

  // services/forum/*.yaml — GHOSTBOARD boards (§10.7).
  const forum: ForumFile[] = [];
  for (const name of await listFiles(join(dir, "services", "forum"), [".yaml", ".yml"])) {
    const file = `services/forum/${name}`;
    const loaded = await loadYaml(collector, dir, `services/forum/${name}`);
    if (loaded === null) continue;
    const checked = ForumSource.safeParse(loaded.data);
    if (!checked.success) {
      collector.schema(file, checked.error, "forum source");
      continue;
    }
    for (const board of checked.data.boards) {
      collectStrings({ threads: board.threads }, file, "forum", strings);
    }
    forum.push({ file, boards: checked.data.boards });
  }

  // services/terminal/fs.yaml + the services/terminal/fs/<host>/** tree.
  let terminalFs: TerminalFsT = { hosts: [] };
  const fsYaml = await loadYaml(collector, dir, "services/terminal/fs.yaml");
  if (fsYaml !== null) {
    strings.push(...fsYaml.strings);
    const checked = TerminalFs.safeParse(fsYaml.data);
    if (!checked.success) collector.schema("services/terminal/fs.yaml", checked.error, "terminal fs");
    else terminalFs = checked.data;
  }
  const terminalFiles = await loadTerminalFiles(collector, dir);
  if (terminalFiles.length > 0 && fsYaml === null) {
    collector.add({
      check: 1,
      file: "services/terminal/fs.yaml",
      message: "fs.yaml is required when terminal files exist under services/terminal/fs/",
    });
  }
  for (const file of terminalFiles) {
    strings.push({ file: `services/terminal/fs/${file.host}/${file.path}`, path: "text", value: file.text });
  }

  collector.throwIfAny();

  return {
    dir,
    world,
    strings,
    people,
    orgs,
    identities,
    facts,
    beliefs,
    statements,
    proofs,
    gates,
    reports,
    hints,
    events,
    forge,
    mail,
    archive,
    forum,
    terminalFs,
    terminalFiles,
  };
}
