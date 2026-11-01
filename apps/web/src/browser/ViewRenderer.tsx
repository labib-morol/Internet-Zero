import { useState, type ReactNode } from "react";
import type {
  ArchiveDocumentView,
  ArchiveSearchView,
  ForgeCommitDetailView,
  ForgeCommitListView,
  ForgeFileBrowserView,
  ForgeIssueDetailView,
  ForgeIssueListView,
  ForgeRepoHome,
  ForgeUserProfileView,
  MailboxView,
  MailMessageView,
  MailThreadView,
  NotFound,
  TerminalView,
  ViewModel,
} from "@iz/schema";
import { SafeAst } from "@iz/ui";
import { useBrowserStore, type Collectible } from "./store.js";

/**
 * Generic in-game page renderer for every ViewModel union member (§10). The
 * per-service, pixel-planned UIs are M1 tasks 4–6; until they land this
 * renderer gives every route an honest, readable page with working in-game
 * links (no real navigation) and the SafeAst document renderer.
 */

export interface ViewRendererProps {
  view: ViewModel;
  collectibles: Collectible[];
  host: string;
  onCollect: (artifactId: string, label?: string) => void;
}

/** Every view shape except the notFound page (handled separately). */
type RenderableView = Exclude<ViewModel, NotFound>;

export function ViewRenderer({ view, collectibles, host, onCollect }: ViewRendererProps): ReactNode {
  if ("notFound" in view) {
    return <NotFoundPage view={view} />;
  }
  return (
    <div className="iz-page">
      <CollectBar collectibles={collectibles} onCollect={onCollect} />
      <article className="iz-doc" data-view={view.view}>
        <ViewBody view={view} host={host} />
      </article>
    </div>
  );
}

function CollectBar({ collectibles, onCollect }: { collectibles: Collectible[]; onCollect: (id: string, label?: string) => void }): ReactNode {
  if (collectibles.length === 0) return null;
  return (
    <div className="iz-toolbar" role="toolbar" aria-label="Collect evidence" style={{ background: "var(--iz-bg3)", borderBottom: "1px solid var(--iz-line)" }}>
      <span style={{ fontSize: 12, color: "var(--iz-faint)" }}>Collect:</span>
      {collectibles.map((c) => (
        <button key={c.artifactId} type="button" className="iz-toolbar__btn" onClick={() => onCollect(c.artifactId, c.label)}>
          + {c.label}
        </button>
      ))}
    </div>
  );
}

function NotFoundPage({ view }: { view: NotFound }): ReactNode {
  return (
    <div className="iz-doc" data-view="not-found">
      <h1>Host not found</h1>
      <p>
        No page answered at <code>{view.host}{view.path}</code>. Check the address, or the host may not
        be reachable from your network.
      </p>
      <p style={{ color: "var(--iz-faint)", fontSize: 12.5 }}>
        Unknown and locked hosts look exactly like this — the network does not confirm what exists (§10.1).
      </p>
    </div>
  );
}

function InspectLayersToggle({ context, enabled, onToggle }: { context: string; enabled: boolean; onToggle: () => void }): ReactNode {
  return (
    <button type="button" className="iz-btn iz-btn--quiet" aria-pressed={enabled} onClick={onToggle}>
      {enabled ? "Hide covered layers" : `Inspect layers (${context})`}
    </button>
  );
}

function ViewBody({ view, host }: { view: RenderableView; host: string }): ReactNode {
  switch (view.view) {
    case "repo-home":
      return <RepoHome view={view} host={host} />;
    case "commit-list":
      return <CommitList view={view} host={host} />;
    case "commit-detail":
      return <CommitDetail view={view} host={host} />;
    case "file-browser":
      return <FileBrowser view={view} host={host} />;
    case "issue-list":
      return <IssueList view={view} host={host} />;
    case "issue-detail":
      return <IssueDetail view={view} host={host} />;
    case "user-profile":
      return <UserProfile view={view} host={host} />;
    case "mailbox":
      return <Mailbox view={view} host={host} />;
    case "thread":
      return <MailThread view={view} />;
    case "message":
      return <MailMessage message={view.message} />;
    case "archive-search":
      return <ArchiveSearch view={view} host={host} />;
    case "archive-document":
      return <ArchiveDocument view={view} />;
    case "terminal":
      return <TerminalFallback view={view} />;
    default:
      return <p>This page type has no renderer yet.</p>;
  }
}

/* --------------------------------- Forge --------------------------------- */

function RepoLink({ host, path, children }: { host: string; path: string; children: ReactNode }): ReactNode {
  const navigate = useBrowserStore((s) => s.navigate);
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        void navigate(host, path);
      }}
    >
      {children}
    </a>
  );
}

function RepoHome({ view, host }: { view: ForgeRepoHome; host: string }): ReactNode {
  const base = `/${view.owner}/${view.name}`;
  return (
    <>
      <p style={{ color: "var(--iz-faint)", fontFamily: "var(--iz-font-mono)", fontSize: 12 }}>
        {view.owner} / {view.name}
      </p>
      <h1>
        {view.name}{" "}
        <a href="#" className="iz-doclink" style={{ fontSize: 13 }} onClick={(e) => { e.preventDefault(); void useBrowserStore.getState().navigate(host, `${base}/commits`); }}>
          commits
        </a>{" "}
        {" · "}
        <a href="#" className="iz-doclink" style={{ fontSize: 13 }} onClick={(e) => { e.preventDefault(); void useBrowserStore.getState().navigate(host, `${base}/issues`); }}>
          issues
        </a>
      </h1>
      <p>{view.description}</p>
      <h2>README</h2>
      <SafeAst node={view.readmeAst} onOpenLink={(url) => openInGame(url)} />
      <h2>Recent commits</h2>
      <ul>
        {view.recentCommits.map((c) => (
          <li key={c.sha}>
            <RepoLink host={host} path={`${base}/commit/${c.sha}`}>
              <code>{c.sha.slice(0, 10)}</code>
            </RepoLink>{" "}
            {c.message} <span style={{ color: "var(--iz-faint)" }}>— {c.authorName}, {c.date.slice(0, 10)}</span>
          </li>
        ))}
      </ul>
      {view.openIssues.length > 0 && (
        <>
          <h2>Open issues</h2>
          <ul>
            {view.openIssues.map((i) => (
              <li key={i.number}>
                <RepoLink host={host} path={`${base}/issues/${i.number}`}>
                  #{i.number} {i.title}
                </RepoLink>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function CommitList({ view, host }: { view: ForgeCommitListView; host: string }): ReactNode {
  const base = `/${view.owner}/${view.name}`;
  return (
    <>
      <h1>
        Commits — {view.owner}/{view.name}
      </h1>
      <ul>
        {view.commits.map((c) => (
          <li key={c.sha}>
            <RepoLink host={host} path={`${base}/commit/${c.sha}`}>
              <code>{c.sha.slice(0, 10)}</code>
            </RepoLink>{" "}
            {c.message}{" "}
            <span style={{ color: "var(--iz-faint)" }}>
              — {c.authorName}, {c.date.slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function CommitDetail({ view, host }: { view: ForgeCommitDetailView; host: string }): ReactNode {
  const c = view.commit;
  const base = `/${view.owner}/${view.name}`;
  return (
    <>
      <p>
        <RepoLink host={host} path={`${base}/commits`}>
          ← all commits
        </RepoLink>
      </p>
      <h1>{c.message}</h1>
      <p style={{ fontFamily: "var(--iz-font-mono)", fontSize: 12.5, color: "var(--iz-dim)" }}>
        commit {c.sha}
        <br />
        author {c.author.name} &lt;{c.author.email}&gt; · {c.date}
        <br />
        committer {c.committer.name} @ {c.committer.host}
        {c.parents.length > 0 && (
          <>
            <br />
            parents {c.parents.join(", ")}
          </>
        )}
      </p>
      {c.signature !== undefined && (
        <p>
          <span className={`iz-signature${c.signature.valid ? "" : " iz-signature--invalid"}`}>
            <span className="iz-signature__name">{c.signature.signer}</span> key {c.signature.keyId} · fp{" "}
            {c.signature.fingerprint} · {c.signature.valid ? "valid" : "INVALID"}
          </span>
        </p>
      )}
      <h2>Changes</h2>
      {c.changes.map((change) => (
        <div key={`${change.kind}-${change.path}`}>
          <h3>
            {change.kind === "add" ? "added" : change.kind === "delete" ? "deleted" : "modified"}:{" "}
            <code>{change.path}</code>
          </h3>
          {change.after !== undefined && (
            <pre>
              <code>{change.after}</code>
            </pre>
          )}
          {change.before !== undefined && change.kind === "delete" && (
            <pre>
              <code>{change.before}</code>
            </pre>
          )}
        </div>
      ))}
    </>
  );
}

function FileBrowser({ view, host }: { view: ForgeFileBrowserView; host: string }): ReactNode {
  const prefix = view.path.endsWith("/") ? view.path : `${view.path}/`;
  return (
    <>
      <h1>
        {view.owner}/{view.name} @ <code>{view.ref}</code>
      </h1>
      <p style={{ fontFamily: "var(--iz-font-mono)", fontSize: 12.5 }}>{view.path}</p>
      <ul>
        {view.entries.map((entry) => (
          <li key={entry.name}>
            <RepoLink host={host} path={`${prefix}${entry.name}`}>
              {entry.kind === "dir" ? `${entry.name}/` : entry.name}
            </RepoLink>
          </li>
        ))}
      </ul>
      {view.file !== null && (
        <>
          <h2>
            <code>{view.file.path}</code>
          </h2>
          <pre>
            <code>{view.file.content}</code>
          </pre>
        </>
      )}
    </>
  );
}

function IssueList({ view, host }: { view: ForgeIssueListView; host: string }): ReactNode {
  const base = `/${view.owner}/${view.name}`;
  return (
    <>
      <h1>
        Issues — {view.owner}/{view.name}
      </h1>
      <ul>
        {view.issues.map((i) => (
          <li key={i.number}>
            <RepoLink host={host} path={`${base}/issues/${i.number}`}>
              #{i.number} {i.title}
            </RepoLink>{" "}
            <span style={{ color: "var(--iz-faint)" }}>
              {i.state} · {i.author.displayName} · {i.date.slice(0, 10)} · {i.commentCount} comments
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function IssueDetail({ view, host }: { view: ForgeIssueDetailView; host: string }): ReactNode {
  const issue = view.issue;
  const base = `/${view.owner}/${view.name}`;
  return (
    <>
      <p>
        <RepoLink host={host} path={`${base}/issues`}>
          ← all issues
        </RepoLink>
      </p>
      <h1>
        #{issue.number} {issue.title}
      </h1>
      <p style={{ color: "var(--iz-dim)" }}>
        {issue.state} · opened by {issue.author.displayName} · {issue.date.slice(0, 10)}
      </p>
      <SafeAst node={issue.ast} onOpenLink={(url) => openInGame(url)} />
      {issue.comments.map((comment, i) => (
        <div key={i}>
          <hr />
          <p style={{ color: "var(--iz-dim)", fontSize: 12.5 }}>
            {comment.author.displayName} · {comment.date.slice(0, 10)}
          </p>
          <SafeAst node={comment.ast} onOpenLink={(url) => openInGame(url)} />
        </div>
      ))}
    </>
  );
}

function UserProfile({ view, host }: { view: ForgeUserProfileView; host: string }): ReactNode {
  return (
    <>
      <h1>{view.login}</h1>
      {view.deleted ? (
        <p>
          <strong style={{ color: "var(--iz-warn)" }}>Account deleted.</strong> The profile data is no
          longer available.
        </p>
      ) : (
        <>
          {view.name !== null && <p style={{ fontSize: 16 }}>{view.name}</p>}
          {view.bio !== null && <p>{view.bio}</p>}
        </>
      )}
      {view.recentCommits.length > 0 && (
        <>
          <h2>Recent commits</h2>
          <ul>
            {view.recentCommits.map((c) => (
              <li key={c.sha}>
                <code>{c.sha.slice(0, 10)}</code> {c.message}
              </li>
            ))}
          </ul>
        </>
      )}
      {view.authoredIssues.length > 0 && (
        <>
          <h2>Authored issues</h2>
          <ul>
            {view.authoredIssues.map((i) => (
              <li key={i.number}>
                #{i.number} {i.title}
              </li>
            ))}
          </ul>
        </>
      )}
      <p style={{ marginTop: 12 }}>
        <RepoLink host={host} path={`/users/${view.login}`}>
          permalink
        </RepoLink>
      </p>
    </>
  );
}

/* ---------------------------------- Mail ---------------------------------- */

function MailMessage({ message, inspectDefault = false }: { message: MailMessageView; inspectDefault?: boolean }): ReactNode {
  const [inspect, setInspect] = useState(inspectDefault);
  const hasRemovable = message.attachments.some((a) => a.hasRemovableRedactions);
  return (
    <section>
      <h2>{message.subject}</h2>
      <p style={{ color: "var(--iz-dim)", fontSize: 12.5, fontFamily: "var(--iz-font-mono)" }}>
        from {message.from.displayName}
        {message.to.length > 0 && <> · to {message.to.map((t) => t.displayName).join(", ")}</>}
        {message.cc.length > 0 && <> · cc {message.cc.map((t) => t.displayName).join(", ")}</>}
        <br />
        {message.date}
      </p>
      {hasRemovable && <InspectLayersToggle context="covered layers" enabled={inspect} onToggle={() => setInspect(!inspect)} />}
      <SafeAst node={message.ast} inspectLayers={inspect} onOpenLink={(url) => openInGame(url)} />
      {message.attachments.length > 0 && (
        <>
          <h3>Attachments</h3>
          <ul>
            {message.attachments.map((a) => (
              <li key={a.assetId}>
                <code>{a.filename}</code>
                {a.hasRemovableRedactions ? " (contains covered layers)" : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {Object.keys(message.headers).length > 0 && (
        <details>
          <summary>View source (headers)</summary>
          <pre>
            <code>{Object.entries(message.headers).map(([k, v]) => `${k}: ${v}`).join("\n")}</code>
          </pre>
        </details>
      )}
    </section>
  );
}

function MailThread({ view }: { view: MailThreadView }): ReactNode {
  return (
    <>
      <h1>{view.subject}</h1>
      {view.messages.map((m) => (
        <MailMessage key={m.artifactId} message={m} />
      ))}
    </>
  );
}

function Mailbox({ view, host }: { view: MailboxView; host: string }): ReactNode {
  return (
    <>
      <h1>
        {view.mailboxId} — {view.folder}
      </h1>
      {view.threads.length === 0 && <p>No messages in this folder.</p>}
      <ul>
        {view.threads.map((t, i) => (
          <li key={i}>
            {t.threadId !== null ? (
              <RepoLink host={host} path={`/${view.mailboxId}/thread/${t.threadId}`}>
                {t.subject}
              </RepoLink>
            ) : (
              t.subject
            )}{" "}
            <span style={{ color: "var(--iz-faint)" }}>
              {t.participants.map((p) => p.displayName).join(", ")} · {t.messageCount} message
              {t.messageCount === 1 ? "" : "s"} · {t.lastDate.slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/* --------------------------------- Archive -------------------------------- */

function ArchiveSearch({ view, host }: { view: ArchiveSearchView; host: string }): ReactNode {
  return (
    <>
      <h1>Search results</h1>
      <p style={{ color: "var(--iz-dim)" }}>
        for <code>{view.query}</code> — {view.results.length} document{view.results.length === 1 ? "" : "s"}
      </p>
      <ul>
        {view.results.map((r) => (
          <li key={r.artifactId}>
            <RepoLink host={host} path={`/documents/${r.artifactId}`}>
              {r.title}
            </RepoLink>{" "}
            <span style={{ color: "var(--iz-faint)" }}>
              {r.type} · {r.date.slice(0, 10)}
            </span>
            <br />
            <span style={{ fontSize: 12.5, color: "var(--iz-dim)" }}>{r.snippet}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function ArchiveDocument({ view }: { view: ArchiveDocumentView }): ReactNode {
  const [inspect, setInspect] = useState(false);
  const doc = view.doc;
  return (
    <>
      <h1>{doc.title}</h1>
      <p style={{ color: "var(--iz-dim)", fontFamily: "var(--iz-font-mono)", fontSize: 12.5 }}>
        {doc.type} · {doc.date.slice(0, 10)} · source {doc.source}
      </p>
      {doc.removableRedactions > 0 && <InspectLayersToggle context={`${doc.removableRedactions} covered layers`} enabled={inspect} onToggle={() => setInspect(!inspect)} />}
      <SafeAst node={doc.ast} inspectLayers={inspect} onOpenLink={(url) => openInGame(url)} />
      {Object.entries(doc.meta).length > 0 && (
        <details>
          <summary>Metadata inspector</summary>
          <table>
            <tbody>
              {Object.entries(doc.meta).map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {doc.assets.length > 0 && (
        <>
          <h2>Files</h2>
          <ul>
            {doc.assets.map((a) => (
              <li key={a.assetId}>{a.label}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/* -------------------------------- Terminal -------------------------------- */

function TerminalFallback({ view }: { view: TerminalView }): ReactNode {
  return (
    <>
      <h1>NODE TERMINAL — {view.host}</h1>
      {view.motd !== null && (
        <pre>
          <code>{view.motd}</code>
        </pre>
      )}
      <p style={{ color: "var(--iz-faint)", fontSize: 12.5 }}>
        cwd {view.cwd} · the interactive terminal (xterm.js) arrives with the NODE TERMINAL UI task; the
        full session lives on the server.
      </p>
      {view.lines.map((line, i) => (
        <pre key={i}>
          <code style={line.stream === "err" ? { color: "var(--iz-bad)" } : undefined}>
            {line.text}
          </code>
        </pre>
      ))}
    </>
  );
}

/** In-game link target from AST: route through the in-game browser store. */
function openInGame(url: string): void {
  const store = useBrowserStore.getState();
  void store.goToAddress(url);
}
