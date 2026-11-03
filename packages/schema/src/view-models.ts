import { z } from "zod";
import { SafeNodeSchema } from "./safe-ast.js";
import { IsoTime } from "./primitives.js";
import { ForgeSignature } from "./entities.js";

/**
 * View models (§10): the ONLY shape in which world content reaches a client.
 * The server builds these after visibility checks; they can never contain
 * canon, answer hashes or locked artifacts.
 */
export const NotFound = z.strictObject({ notFound: z.literal(true), host: z.string(), path: z.string() });
export type NotFound = z.infer<typeof NotFound>;

export const IdentityRef = z.strictObject({
  identityId: z.string(),
  displayName: z.string(),
  login: z.string().optional(),
  deleted: z.boolean().default(false),
});
export type IdentityRef = z.infer<typeof IdentityRef>;

// ---------------------------------------------------------------------------
// GIT//FORGE (§10.2)
// ---------------------------------------------------------------------------

export const ForgeCommitSummary = z.strictObject({
  sha: z.string(),
  date: IsoTime,
  message: z.string(),
  authorName: z.string(),
  authorIdentity: z.string().optional(),
});
export type ForgeCommitSummary = z.infer<typeof ForgeCommitSummary>;

export const ForgeCommitDetail = z.strictObject({
  sha: z.string(),
  parents: z.array(z.string()),
  author: z.strictObject({ name: z.string(), email: z.string(), identity: z.string().optional() }),
  committer: z.strictObject({ name: z.string(), email: z.string(), host: z.string() }),
  date: IsoTime,
  message: z.string(),
  signature: ForgeSignature.optional(),
  changes: z.array(
    z.strictObject({
      path: z.string(),
      kind: z.enum(["add", "modify", "delete"]),
      before: z.string().optional(),
      after: z.string().optional(),
    })
  ),
});
export type ForgeCommitDetail = z.infer<typeof ForgeCommitDetail>;

export const ForgeRepoHome = z.strictObject({
  view: z.literal("repo-home"),
  artifactId: z.string(),
  owner: z.string(),
  name: z.string(),
  description: z.string(),
  defaultBranch: z.string(),
  readmeAst: SafeNodeSchema,
  recentCommits: z.array(ForgeCommitSummary),
  openIssues: z.array(z.strictObject({ number: z.number().int(), title: z.string() })),
});
export type ForgeRepoHome = z.infer<typeof ForgeRepoHome>;

export const ForgeCommitListView = z.strictObject({
  view: z.literal("commit-list"),
  artifactId: z.string(),
  owner: z.string(),
  name: z.string(),
  commits: z.array(ForgeCommitSummary),
});
export type ForgeCommitListView = z.infer<typeof ForgeCommitListView>;

export const ForgeCommitDetailView = z.strictObject({
  view: z.literal("commit-detail"),
  artifactId: z.string(),
  owner: z.string(),
  name: z.string(),
  commit: ForgeCommitDetail,
});
export type ForgeCommitDetailView = z.infer<typeof ForgeCommitDetailView>;

export const ForgeFileBrowserView = z.strictObject({
  view: z.literal("file-browser"),
  artifactId: z.string().nullable(),
  owner: z.string(),
  name: z.string(),
  ref: z.string(),
  path: z.string(),
  entries: z.array(z.strictObject({ name: z.string(), kind: z.enum(["dir", "file"]) })),
  file: z.strictObject({ path: z.string(), content: z.string() }).nullable(),
});
export type ForgeFileBrowserView = z.infer<typeof ForgeFileBrowserView>;

export const ForgeIssueSummary = z.strictObject({
  number: z.number().int(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  author: IdentityRef,
  date: IsoTime,
  commentCount: z.number().int(),
});
export type ForgeIssueSummary = z.infer<typeof ForgeIssueSummary>;

export const ForgeIssueListView = z.strictObject({
  view: z.literal("issue-list"),
  artifactId: z.string(),
  owner: z.string(),
  name: z.string(),
  issues: z.array(ForgeIssueSummary),
});
export type ForgeIssueListView = z.infer<typeof ForgeIssueListView>;

export const ForgeIssueDetailView = z.strictObject({
  view: z.literal("issue-detail"),
  artifactId: z.string(),
  owner: z.string(),
  name: z.string(),
  issue: z.strictObject({
    number: z.number().int(),
    title: z.string(),
    state: z.enum(["open", "closed"]),
    author: IdentityRef,
    date: IsoTime,
    ast: SafeNodeSchema,
    comments: z.array(z.strictObject({ author: IdentityRef, date: IsoTime, ast: SafeNodeSchema })),
  }),
});
export type ForgeIssueDetailView = z.infer<typeof ForgeIssueDetailView>;

export const ForgeUserProfileView = z.strictObject({
  view: z.literal("user-profile"),
  artifactId: z.string().nullable(),
  login: z.string(),
  name: z.string().nullable(),
  bio: z.string().nullable(),
  deleted: z.boolean(),
  recentCommits: z.array(ForgeCommitSummary),
  authoredIssues: z.array(ForgeIssueSummary),
});
export type ForgeUserProfileView = z.infer<typeof ForgeUserProfileView>;

export const ForgeView = z.discriminatedUnion("view", [
  ForgeRepoHome,
  ForgeCommitListView,
  ForgeCommitDetailView,
  ForgeFileBrowserView,
  ForgeIssueListView,
  ForgeIssueDetailView,
  ForgeUserProfileView,
]);
export type ForgeView = z.infer<typeof ForgeView>;

// ---------------------------------------------------------------------------
// DEADLETTER (§10.3)
// ---------------------------------------------------------------------------

export const MailAttachment = z.strictObject({
  assetId: z.string(),
  filename: z.string(),
  hasRemovableRedactions: z.boolean(),
});
export type MailAttachment = z.infer<typeof MailAttachment>;

export const MailMessageView = z.strictObject({
  artifactId: z.string(),
  from: IdentityRef,
  to: z.array(IdentityRef),
  cc: z.array(IdentityRef),
  date: IsoTime,
  subject: z.string(),
  ast: SafeNodeSchema,
  attachments: z.array(MailAttachment),
  headers: z.record(z.string(), z.string()),
});
export type MailMessageView = z.infer<typeof MailMessageView>;

export const MailThreadSummary = z.strictObject({
  threadId: z.string().nullable(),
  subject: z.string(),
  participants: z.array(IdentityRef),
  lastDate: IsoTime,
  messageCount: z.number().int(),
});
export type MailThreadSummary = z.infer<typeof MailThreadSummary>;

export const MailboxView = z.strictObject({
  view: z.literal("mailbox"),
  mailboxId: z.string(),
  folder: z.enum(["inbox", "sent", "drafts", "archive"]),
  threads: z.array(MailThreadSummary),
});
export type MailboxView = z.infer<typeof MailboxView>;

export const MailThreadView = z.strictObject({
  view: z.literal("thread"),
  mailboxId: z.string(),
  subject: z.string(),
  messages: z.array(MailMessageView),
});
export type MailThreadView = z.infer<typeof MailThreadView>;

export const MailMessageViewSingle = z.strictObject({
  view: z.literal("message"),
  mailboxId: z.string(),
  message: MailMessageView,
});
export type MailMessageViewSingle = z.infer<typeof MailMessageViewSingle>;

export const MailView = z.discriminatedUnion("view", [MailboxView, MailThreadView, MailMessageViewSingle]);
export type MailView = z.infer<typeof MailView>;

// ---------------------------------------------------------------------------
// THE ARCHIVE (§10.4)
// ---------------------------------------------------------------------------

export const ArchiveSearchResult = z.strictObject({
  artifactId: z.string(),
  title: z.string(),
  type: z.string(),
  date: IsoTime,
  snippet: z.string(),
});
export type ArchiveSearchResult = z.infer<typeof ArchiveSearchResult>;

export const ArchiveSearchView = z.strictObject({
  view: z.literal("archive-search"),
  query: z.string(),
  results: z.array(ArchiveSearchResult),
});
export type ArchiveSearchView = z.infer<typeof ArchiveSearchView>;

export const ArchiveDocumentView = z.strictObject({
  view: z.literal("archive-document"),
  artifactId: z.string(),
  doc: z.strictObject({
    id: z.string(),
    title: z.string(),
    type: z.string(),
    date: IsoTime,
    source: z.string(),
    ast: SafeNodeSchema,
    meta: z.record(z.string(), z.string()),
    assets: z.array(z.strictObject({ assetId: z.string(), label: z.string() })),
    removableRedactions: z.number().int(),
  }),
});
export type ArchiveDocumentView = z.infer<typeof ArchiveDocumentView>;

export const ArchiveView = z.discriminatedUnion("view", [ArchiveSearchView, ArchiveDocumentView]);
export type ArchiveView = z.infer<typeof ArchiveView>;

// ---------------------------------------------------------------------------
// NODE TERMINAL (§10.5) — cwd is client-held; output is appended per command
// ---------------------------------------------------------------------------

export const TerminalLine = z.strictObject({ stream: z.enum(["out", "err"]), text: z.string() });
export type TerminalLine = z.infer<typeof TerminalLine>;

export const TerminalView = z.strictObject({
  view: z.literal("terminal"),
  host: z.string(),
  cwd: z.string(),
  motd: z.string().nullable(),
  lines: z.array(TerminalLine),
  /** Set when the command was `connect <host>` and a passphrase gate applies. */
  passphrasePrompt: z.boolean().default(false),
});
export type TerminalView = z.infer<typeof TerminalView>;

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// GHOSTBOARD (§10.7, M2)
// ---------------------------------------------------------------------------

export const ForumBoardSummary = z.strictObject({
  boardId: z.string(),
  name: z.string(),
  threads: z.number().int(),
  posts: z.number().int(),
});
export type ForumBoardSummary = z.infer<typeof ForumBoardSummary>;

export const ForumThreadSummary = z.strictObject({
  threadId: z.string(),
  title: z.string(),
  pinned: z.boolean(),
  posts: z.number().int(),
  lastAt: z.string(),
  lastAuthor: z.string(),
});
export type ForumThreadSummary = z.infer<typeof ForumThreadSummary>;

export const ForumBoardListView = z.strictObject({
  view: z.literal("forum-board-list"),
  host: z.string(),
  boards: z.array(ForumBoardSummary),
});
export type ForumBoardListView = z.infer<typeof ForumBoardListView>;

export const ForumBoardView = z.strictObject({
  view: z.literal("forum-board"),
  host: z.string(),
  artifactId: z.string().nullable(),
  boardId: z.string(),
  boardName: z.string(),
  threads: z.array(ForumThreadSummary),
});
export type ForumBoardView = z.infer<typeof ForumBoardView>;

export const ForumPostView = z.strictObject({
  artifactId: z.string(),
  author: IdentityRef,
  at: IsoTime,
  ast: SafeNodeSchema,
  deleted: z.boolean(),
  edits: z.number().int(),
});
export type ForumPostView = z.infer<typeof ForumPostView>;

export const ForumThreadView = z.strictObject({
  view: z.literal("forum-thread"),
  host: z.string(),
  artifactId: z.string(),
  boardId: z.string(),
  threadId: z.string(),
  title: z.string(),
  pinned: z.boolean(),
  posts: z.array(ForumPostView),
});
export type ForumThreadView = z.infer<typeof ForumThreadView>;

export const ForumView = z.discriminatedUnion("view", [ForumBoardListView, ForumBoardView, ForumThreadView]);
export type ForumView = z.infer<typeof ForumView>;

export const ViewModel = z.union([
  ForgeView,
  MailView,
  ArchiveView,
  TerminalView,
  ForumView,
  NotFound,
]);
export type ViewModel = ForgeView | MailView | ArchiveView | TerminalView | ForumView | NotFound;
