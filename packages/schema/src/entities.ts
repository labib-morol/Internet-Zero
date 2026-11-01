import { z } from "zod";
import { Id, IsoTime, Condition } from "./primitives.js";

export const ServiceId = z.enum(["forge", "mail", "archive", "terminal", "forum"]);
export type ServiceId = z.infer<typeof ServiceId>;

export const Person = z.strictObject({
  id: Id,
  displayName: z.string().min(1),
  role: z.string().optional(),
  bio: z.string().optional(),
});
export type Person = z.infer<typeof Person>;

export const Org = z.strictObject({
  id: Id,
  name: z.string().min(1),
  kind: z.string().optional(),
  description: z.string().optional(),
});
export type Org = z.infer<typeof Org>;

export const Identity = z.strictObject({
  id: Id,
  service: ServiceId,
  login: z.string().min(1),
  displayName: z.string().min(1),
  person: Id.optional(),
  org: Id.optional(),
  deleted: z.boolean().default(false),
  meta: z.record(z.string(), z.string()).optional(),
});
export type Identity = z.infer<typeof Identity>;

/** Content-addressed asset after build. */
export const Asset = z.strictObject({
  id: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().min(1),
  contentType: z.string().min(1),
});
export type Asset = z.infer<typeof Asset>;

// ---------------------------------------------------------------------------
// GIT//FORGE source (§10.2)
// ---------------------------------------------------------------------------

export const Sha256Hex = z.string().regex(/^[0-9a-f]{40}$/);

export const ForgeSignature = z.strictObject({
  keyId: z.string(),
  fingerprint: z.string(),
  valid: z.boolean(),
  signer: Id,
});
export type ForgeSignature = z.infer<typeof ForgeSignature>;

export const ForgeChange = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("add"), path: z.string().min(1), after: z.string() }),
  z.strictObject({ kind: z.literal("modify"), path: z.string().min(1), before: z.string(), after: z.string() }),
  z.strictObject({ kind: z.literal("delete"), path: z.string().min(1), before: z.string() }),
]);
export type ForgeChange = z.infer<typeof ForgeChange>;

export const ForgeCommit = z.strictObject({
  sha: Sha256Hex,
  parents: z.array(Sha256Hex).default([]),
  author: z.strictObject({ name: z.string(), email: z.string(), identity: Id.optional() }),
  committer: z.strictObject({ name: z.string(), email: z.string(), host: z.string() }),
  date: IsoTime,
  message: z.string().min(1),
  signature: ForgeSignature.optional(),
  changes: z.array(ForgeChange).min(1),
});
export type ForgeCommit = z.infer<typeof ForgeCommit>;

export const ForgeUser = z.strictObject({
  login: z.string().min(1),
  name: z.string().optional(),
  bio: z.string().optional(),
  identity: Id.optional(),
  deleted: z.boolean().default(false),
});
export type ForgeUser = z.infer<typeof ForgeUser>;

export const ForgeComment = z.strictObject({
  author: Id,
  date: IsoTime,
  body: z.string(),
});
export type ForgeComment = z.infer<typeof ForgeComment>;

export const ForgeIssue = z.strictObject({
  number: z.number().int().min(1),
  title: z.string().min(1),
  body: z.string(),
  author: Id,
  date: IsoTime,
  state: z.enum(["open", "closed"]).default("open"),
  comments: z.array(ForgeComment).default([]),
});
export type ForgeIssue = z.infer<typeof ForgeIssue>;

export const ForgeRepo = z.strictObject({
  id: Id,
  owner: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  defaultBranch: z.string().default("main"),
  readme: z.string(),
  branches: z.array(z.string()).default([]),
  users: z.array(ForgeUser).default([]),
  commits: z.array(ForgeCommit).default([]),
  issues: z.array(ForgeIssue).default([]),
});
export type ForgeRepo = z.infer<typeof ForgeRepo>;

// ---------------------------------------------------------------------------
// DEADLETTER mail source (§10.3)
// ---------------------------------------------------------------------------

export const MailRedaction = z.strictObject({
  kind: z.literal("redaction"),
  text: z.string(),
  removable: z.boolean(),
});
export type MailRedaction = z.infer<typeof MailRedaction>;

export const MailMessage = z.strictObject({
  id: Id,
  mailbox: Id,
  folder: z.enum(["inbox", "sent", "drafts", "archive"]).default("inbox"),
  thread: Id.optional(),
  from: Id,
  to: z.array(Id).min(1),
  cc: z.array(Id).default([]),
  date: IsoTime,
  subject: z.string(),
  body: z.string(),
  attachments: z
    .array(z.strictObject({ asset: z.string(), filename: z.string(), redactions: z.array(MailRedaction).default([]) }))
    .default([]),
  headers: z.record(z.string(), z.string()).optional(),
});
export type MailMessage = z.infer<typeof MailMessage>;

export const Mailbox = z.strictObject({
  id: Id,
  owner: Id,
  messages: z.array(MailMessage).default([]),
});
export type Mailbox = z.infer<typeof Mailbox>;

// ---------------------------------------------------------------------------
// THE ARCHIVE document front matter (§10.4)
// ---------------------------------------------------------------------------

export const ArchiveDocMeta = z.strictObject({
  id: Id,
  title: z.string().min(1),
  type: z.enum(["report", "letter", "contract", "listing", "keyserver-dump", "abstract"]),
  date: IsoTime,
  source: z.string(),
  assets: z.array(z.string()).default([]),
  redactions: z.array(MailRedaction).default([]),
  meta: z.record(z.string(), z.string()).optional(),
});
export type ArchiveDocMeta = z.infer<typeof ArchiveDocMeta>;

// ---------------------------------------------------------------------------
// NODE TERMINAL filesystem metadata (§10.5) — files come from the fs tree
// ---------------------------------------------------------------------------

export const TerminalHostMeta = z.strictObject({
  host: z.string().min(1),
  motd: z.string().optional(),
  /** Passphrase gate id bound to `connect` for this host, if any. */
  connectGate: Id.optional(),
});
export type TerminalHostMeta = z.infer<typeof TerminalHostMeta>;
export const TerminalFs = z.strictObject({
  hosts: z.array(TerminalHostMeta).min(1),
});
export type TerminalFs = z.infer<typeof TerminalFs>;

// ---------------------------------------------------------------------------
// World events (§13)
// ---------------------------------------------------------------------------

export const EventTrigger = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("after"), gateSolved: Id }),
  z.strictObject({ kind: z.literal("at"), time: IsoTime }),
]);
export type EventTrigger = z.infer<typeof EventTrigger>;

export const EventEffect = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("deliverMail"), mailbox: Id, message: Id }),
  z.strictObject({ kind: z.literal("reveal"), artifact: Id }),
  z.strictObject({ kind: z.literal("revealHosts"), hosts: z.array(z.string()).min(1) }),
  z.strictObject({ kind: z.literal("addCommit"), repo: Id, commit: Id }),
]);
export type EventEffect = z.infer<typeof EventEffect>;

export const EventDef = z.strictObject({
  id: Id,
  trigger: EventTrigger,
  /** Visibility condition gating the whole event (optional extra guard). */
  requires: Condition.optional(),
  effects: z.array(EventEffect).min(1),
});
export type EventDef = z.infer<typeof EventDef>;
