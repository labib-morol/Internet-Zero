import type {
  Artifact,
  Collectible,
  ForgeCommitDetail,
  ForgeCommitSummary,
  ForgeIssueSummary,
  ForgeView,
  MailView,
  ArchiveView,
  IdentityRef,
  NotFound,
  RuntimeState,
  TerminalView,
  ViewModel,
  WorldBundle,
} from "@iz/schema";
import { artifactVisible } from "@iz/runtime";

/**
 * View-model builders (§10). The server calls these AFTER checking host
 * reachability for the page's artifact; thread/tree aggregations filter their
 * members by visibility internally so locked content can never leak.
 * `now` is injected by the server (view evaluates time-based visibility).
 */

type IsUnlocked = (id: string) => boolean;

function visible(bundle: WorldBundle, state: RuntimeState, artifact: Artifact, now: string): boolean {
  const isUnlocked: IsUnlocked = (id) => state.unlocked.has(id);
  return artifactVisible(bundle, artifact, state, isUnlocked, now);
}

function notFound(host: string, path: string): NotFound {
  return { notFound: true, host, path };
}

export function identityRef(bundle: WorldBundle, id: string): IdentityRef {
  const identity = bundle.identities.find((i) => i.id === id);
  if (identity === undefined) return { identityId: id, displayName: id, deleted: false };
  return {
    identityId: identity.id,
    displayName: identity.displayName,
    ...(identity.service === "forge" ? { login: identity.login } : {}),
    deleted: identity.deleted,
  };
}

// ---------------------------------------------------------------------------
// GIT//FORGE
// ---------------------------------------------------------------------------

function commitSummary(bundle: WorldBundle, repoOwner: string, repoName: string, commit: { sha: string; date: string; message: string; author: { name: string; identity?: string } }): ForgeCommitSummary {
  void bundle;
  void repoOwner;
  void repoName;
  return {
    sha: commit.sha,
    date: commit.date,
    message: commit.message,
    authorName: commit.author.name,
    ...(commit.author.identity !== undefined ? { authorIdentity: commit.author.identity } : {}),
  };
}

function treeAtCommit(repo: WorldBundle["forge"][number], sha: string): Array<{ path: string; kind: "add" | "modify" | "delete"; after?: string; before?: string }> {
  // Replay the change list up to and including sha (commits are ordered oldest-first in source).
  const index = repo.commits.findIndex((c) => c.sha === sha);
  if (index === -1) return [];
  const files = new Map<string, { kind: "add" | "modify" | "delete"; after?: string; before?: string }>();
  for (const commit of repo.commits.slice(0, index + 1)) {
    for (const change of commit.changes) {
      if (change.kind === "delete") {
        files.delete(change.path);
      } else if (change.kind === "modify") {
        files.set(change.path, { kind: "modify", after: change.after, before: change.before });
      } else {
        files.set(change.path, { kind: "add", after: change.after });
      }
    }
  }
  return [...files.entries()].map(([path, v]) => ({ path, ...v }));
}

export function forgeView(bundle: WorldBundle, state: RuntimeState, host: string, rawPath: string, now: string): ForgeView | NotFound {
  const path = rawPath.replace(/^\//, "");
  const repos = bundle.forge
    .filter((r) => bundle.artifacts.some((a) => a.kind === 'repo' && a.host === host && a.path === `${r.owner}/${r.name}` && visible(bundle, state, a, now)))
    .map((repo) => ({ ...repo,
      commits: repo.commits.filter((c) => bundle.artifacts.some((a) => a.id === `a.${c.sha}` && visible(bundle, state, a, now))),
      issues: repo.issues.filter((i) => bundle.artifacts.some((a) => a.kind === 'issue' && a.host === host && a.path === `${repo.owner}/${repo.name}/issues/${i.number}` && visible(bundle, state, a, now))),
    }));
  const segments = path.split("/").filter((s) => s !== "");

  // /users/{login}
  if (segments[0] === "users" && segments.length === 2) {
    const login = segments[1]!;
    const user = repos.flatMap((r) => r.users).find((u) => u.login === login);
    if (user === undefined) return notFound(host, rawPath);
    const artifact = bundle.artifacts.find((a) => a.host === host && a.path === `users/${login}`);
    if (artifact === undefined || !visible(bundle, state, artifact, now)) return notFound(host, rawPath);
    const commits = repos
      .flatMap((r) =>
        r.commits
          .filter((c) => c.author.identity === user.identity)
          .map((c) => commitSummary(bundle, r.owner, r.name, c))
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 20);
    const issues = repos.flatMap((r) => r.issues.filter((i) => i.author === user.identity)).map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      author: identityRef(bundle, i.author),
      date: i.date,
      commentCount: i.comments.length,
    }));
    return {
      view: "user-profile",
      artifactId: artifact.id,
      login: user.login,
      name: user.name ?? null,
      bio: user.bio ?? null,
      deleted: user.deleted,
      recentCommits: commits,
      authoredIssues: issues satisfies ForgeIssueSummary[],
    };
  }

  const [owner, name, third, fourth, ...rest] = segments;
  if (owner === undefined || name === undefined) return notFound(host, rawPath);
  const repo = repos.find((r) => r.owner === owner && r.name === name);
  if (repo === undefined) return notFound(host, rawPath);
  const repoArtifact = bundle.artifacts.find((a) => a.kind === "repo" && a.host === host && a.path === `${owner}/${name}`);
  const base = { owner, name };

  if (third === undefined && repoArtifact !== undefined && visible(bundle, state, repoArtifact, now)) {
    const recentCommits = [...repo.commits]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((c) => commitSummary(bundle, owner, name, c))
      .slice(0, 10);
    return {
      view: "repo-home",
      artifactId: repoArtifact.id,
      ...base,
      description: repo.description,
      defaultBranch: repo.defaultBranch,
      readmeAst: repoArtifact.ast,
      recentCommits,
      openIssues: repo.issues.filter((i) => i.state === "open").map((i) => ({ number: i.number, title: i.title })),
    };
  }

  if (third === "commits" && repoArtifact !== undefined) {
    if (!visible(bundle, state, repoArtifact, now)) return notFound(host, rawPath);
    return {
      view: "commit-list",
      artifactId: repoArtifact.id,
      ...base,
      commits: [...repo.commits].sort((a, b) => b.date.localeCompare(a.date)).map((c) => commitSummary(bundle, owner, name, c)),
    };
  }

  if (third === "commit" && fourth !== undefined) {
    const sha = fourth;
    const commit = repo.commits.find((c) => c.sha === sha);
    const artifact = bundle.artifacts.find((a) => a.kind === "commit" && a.host === host && a.path === `${owner}/${name}/commit/${sha}`);
    if (commit === undefined || artifact === undefined || !visible(bundle, state, artifact, now)) return notFound(host, rawPath);
    const detail: ForgeCommitDetail = {
      sha: commit.sha,
      parents: commit.parents,
      author: { name: commit.author.name, email: commit.author.email, ...(commit.author.identity !== undefined ? { identity: commit.author.identity } : {}) },
      committer: commit.committer,
      date: commit.date,
      message: commit.message,
      ...(commit.signature !== undefined ? { signature: commit.signature } : {}),
      changes: commit.changes.map((ch) => ({
        path: ch.path,
        kind: ch.kind,
        ...(ch.kind !== "delete" ? { after: ch.after } : {}),
        ...(ch.kind !== "add" ? { before: ch.before } : {}),
      })),
    };
    return { view: "commit-detail", artifactId: artifact.id, ...base, commit: detail };
  }

  if (third === "tree" && fourth !== undefined) {
    const ref = fourth;
    const ordered = [...repo.commits].sort((a, b) => a.date.localeCompare(b.date));
    const resolvedRef = repo.branches.includes(ref) || ref === repo.defaultBranch ? ordered[ordered.length - 1]?.sha : ref;
    if (resolvedRef === undefined) return notFound(host, rawPath);
    const subPath = rest.length > 0 ? rest.join("/") : "";
    const files = treeAtCommit({ ...repo, commits: ordered }, resolvedRef);
    if (files.length === 0 && repo.commits.every((c) => c.sha !== resolvedRef)) return notFound(host, rawPath);
    const dirPrefix = subPath === "" ? "" : `${subPath}/`;
    const entries = new Map<string, "dir" | "file">();
    for (const f of files) {
      if (!f.path.startsWith(dirPrefix)) continue;
      const remainder = f.path.slice(dirPrefix.length);
      const slash = remainder.indexOf("/");
      if (slash === -1) entries.set(remainder, "file");
      else entries.set(remainder.slice(0, slash), "dir");
    }
    const content = subPath === "" ? undefined : files.find((f) => f.path === subPath);
    return {
      view: "file-browser",
      artifactId: null,
      ...base,
      ref,
      path: subPath,
      entries: [...entries.entries()].map(([e, kind]) => ({ name: e, kind })).sort((a, b) => a.name.localeCompare(b.name)),
      file:
        content === undefined
          ? null
          : { path: subPath, content: content.kind === "delete" ? "" : (content.after ?? "") },
    };
  }

  if (third === "issues" && fourth === undefined && repoArtifact !== undefined) {
    if (!visible(bundle, state, repoArtifact, now)) return notFound(host, rawPath);
    return {
      view: "issue-list",
      artifactId: repoArtifact.id,
      ...base,
      issues: repo.issues.map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        author: identityRef(bundle, i.author),
        date: i.date,
        commentCount: i.comments.length,
      })),
    };
  }

  if (third === "issues" && fourth !== undefined) {
    const number = Number.parseInt(fourth, 10);
    const issue = repo.issues.find((i) => i.number === number);
    const artifact = bundle.artifacts.find((a) => a.kind === "issue" && a.host === host && a.path === `${owner}/${name}/issues/${number}`);
    if (issue === undefined || artifact === undefined || !visible(bundle, state, artifact, now)) return notFound(host, rawPath);
    return {
      view: "issue-detail",
      artifactId: artifact.id,
      ...base,
      issue: {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        author: identityRef(bundle, issue.author),
        date: issue.date,
        ast: artifact.ast,
        comments: issue.comments.map((c) => ({ author: identityRef(bundle, c.author), date: c.date, ast: artifact.ast })),
      },
    };
  }

  return notFound(host, rawPath);
}

export function forgeCollectibles(view: ViewModel): Collectible[] {
  if (!("view" in view) || !("artifactId" in view) || typeof view.artifactId !== "string" || view.artifactId.length === 0) return [];
  const labels: Record<string, string> = {
    "repo-home": "Repository",
    "commit-list": "Commit history",
    "commit-detail": "Commit",
    "issue-list": "Issue tracker",
    "issue-detail": "Issue",
    "user-profile": "User profile",
  };
  return [{ artifactId: view.artifactId, label: labels[view.view] ?? view.view }];
}

// ---------------------------------------------------------------------------
// DEADLETTER
// ---------------------------------------------------------------------------

export function mailView(bundle: WorldBundle, state: RuntimeState, host: string, rawPath: string, now: string): MailView | NotFound {
  const path = rawPath.replace(/^\//, "");
  const segments = path.split("/").filter((s) => s !== "");
  const [mailboxId, second, third] = segments;
  const mailbox = bundle.mailboxes.find((m) => m.id === mailboxId);
  if (mailbox === undefined) return notFound(host, rawPath);
  const messages = mailbox.messages.filter((msg) => {
    const artifact = bundle.artifacts.find((a) => a.id === msg.id);
    return artifact !== undefined && visible(bundle, state, artifact, now);
  });
  if (messages.length === 0) return notFound(host, rawPath);

  const messageView = (msg: (typeof messages)[number]) => {
    const artifact = bundle.artifacts.find((a) => a.id === msg.id)!;
    const headers = (artifact.meta.headers !== undefined && typeof artifact.meta.headers === "string" ? JSON.parse(artifact.meta.headers) : {}) as Record<string, string>;
    const attachments = (artifact.meta.attachments !== undefined && typeof artifact.meta.attachments === "string" ? JSON.parse(artifact.meta.attachments) : []) as Array<{ asset: string; filename: string; redactions: Array<{ removable: boolean }> }>;
    return {
      artifactId: msg.id,
      from: identityRef(bundle, msg.from),
      to: msg.to.map((t) => identityRef(bundle, t)),
      cc: msg.cc.map((c) => identityRef(bundle, c)),
      date: msg.date,
      subject: msg.subject,
      ast: artifact.ast,
      attachments: attachments.map((a) => ({ assetId: a.asset, filename: a.filename, hasRemovableRedactions: a.redactions.some((r) => r.removable) })),
      headers,
    };
  };

  if (second === "thread" && third !== undefined) {
    const thread = messages.filter((m) => m.thread === third).sort((a, b) => a.date.localeCompare(b.date));
    if (thread.length === 0) return notFound(host, rawPath);
    return {
      view: "thread",
      mailboxId: mailbox.id,
      subject: thread[0]!.subject,
      messages: thread.map(messageView),
    };
  }

  if (second !== undefined && third !== undefined) {
    const msg = messages.find((m) => m.id === third && m.folder === second);
    if (msg === undefined) return notFound(host, rawPath);
    return { view: "message", mailboxId: mailbox.id, message: messageView(msg) };
  }

  const byFolder = new Map<string, typeof messages>();
  for (const m of messages) {
    const list = byFolder.get(m.folder) ?? [];
    list.push(m);
    byFolder.set(m.folder, list);
  }
  const threads = [...byFolder.entries()].flatMap(([folder, list]) => {
    const groups = new Map<string, typeof list>();
    for (const m of list) {
      const key = m.thread ?? m.id;
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    return [...groups.values()].map((group) => {
      const last = [...group].sort((a, b) => b.date.localeCompare(a.date))[0]!;
      return {
        threadId: group[0]!.thread ?? null,
        subject: last.subject,
        participants: [...new Set(group.flatMap((m) => [m.from, ...m.to]))].map((id) => identityRef(bundle, id)),
        lastDate: last.date,
        messageCount: group.length,
        ...(folder !== "inbox" ? { folder } : {}),
      };
    });
  }).sort((a, b) => b.lastDate.localeCompare(a.lastDate));

  return { view: "mailbox", mailboxId: mailbox.id, folder: "inbox", threads };
}

export function mailCollectibles(view: ViewModel): Collectible[] {
  if (!("view" in view)) return [];
  if (view.view === "message") return [{ artifactId: view.message.artifactId, label: view.message.subject }];
  if (view.view === "thread") return view.messages.map((m) => ({ artifactId: m.artifactId, label: m.subject }));
  return [];
}

// ---------------------------------------------------------------------------
// THE ARCHIVE
// ---------------------------------------------------------------------------

export function archiveView(bundle: WorldBundle, state: RuntimeState, host: string, rawPath: string, now: string): ArchiveView | NotFound {
  const path = rawPath.replace(/^\//, "");
  const segments = path.split("/").filter((s) => s !== "");

  if (segments[0] === "search") {
    const query = decodeURIComponent(segments.slice(1).join("/") ?? "");
    const q = query.toLowerCase();
    const results = bundle.artifacts
      .filter((a) => a.kind === "archive-document" && a.host === host && visible(bundle, state, a, now))
      .filter((a) => q === "" || a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q))
      .sort((a, b) => (a.title.toLowerCase().startsWith(q) ? -1 : 0) - (b.title.toLowerCase().startsWith(q) ? -1 : 0) || a.title.localeCompare(b.title))
      .slice(0, 20)
      .map((a) => ({ artifactId: a.id, title: a.title, type: String(a.meta.type ?? "document"), date: String(a.meta.date ?? ""), snippet: a.body.slice(0, 160) }));
    return { view: "archive-search", query, results };
  }

  if (segments[0] === "doc" && segments[1] !== undefined) {
    const id = segments[1];
    const artifact = bundle.artifacts.find((a) => a.kind === "archive-document" && a.host === host && (a.id === id || a.path === `documents/${id}`));
    if (artifact === undefined || !visible(bundle, state, artifact, now)) return notFound(host, rawPath);
    const doc = bundle.artifacts.find((a) => a.id === artifact.id)!;
    const removableRedactions = countRemovableRedactions(doc.ast);
    return {
      view: "archive-document",
      artifactId: doc.id,
      doc: {
        id: doc.id,
        title: doc.title,
        type: String(doc.meta.type ?? "document"),
        date: String(doc.meta.date ?? ""),
        source: String(doc.meta.source ?? ""),
        ast: doc.ast,
        meta: Object.fromEntries(Object.entries(doc.meta).filter(([key]) => key !== 'redactions').map(([k, v]) => [k, String(v)])),
        assets: [],
        removableRedactions,
      },
    };
  }

  if (segments.length === 0) return { view: "archive-search", query: "", results: [] };
  return notFound(host, rawPath);
}

function countRemovableRedactions(node: { type: string; [k: string]: unknown }): number {
  if (node.type === "redaction" && node.removable === true) return 1;
  let count = 0;
  for (const child of (node.children as Array<{ type: string; [k: string]: unknown }> | undefined) ?? []) count += countRemovableRedactions(child);
  return count;
}

export function archiveCollectibles(view: ViewModel): Collectible[] {
  if ("view" in view && view.view === "archive-document") return [{ artifactId: view.artifactId, label: view.doc.title }];
  return [];
}

// ---------------------------------------------------------------------------
// NODE TERMINAL
// ---------------------------------------------------------------------------

export function terminalView(bundle: WorldBundle, state: RuntimeState, host: string, rawPath: string, _now: string): TerminalView | NotFound {
  void _now;
  if (rawPath !== "/" && rawPath !== "") return notFound(host, rawPath);
  const terminalFile = bundle.artifacts.find((a) => a.host === host && a.kind === "terminal-file");
  const motd = typeof terminalFile?.meta.motd === "string" ? terminalFile.meta.motd : null;
  // A passphrase prompt is an answer gate bound to this host (§10.5): while it
  // is unsolved the terminal only offers the prompt.
  const connectGate = typeof terminalFile?.meta.connectGate === "string" ? terminalFile.meta.connectGate : undefined;
  const passphrasePrompt = connectGate !== undefined && state.solvedGates[connectGate] === undefined;
  return { view: "terminal", host, cwd: "/", motd, lines: [], passphrasePrompt };
}

export function terminalCollectibles(_view: ViewModel): Collectible[] {
  return [];
}
