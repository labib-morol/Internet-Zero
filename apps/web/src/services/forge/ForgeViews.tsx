import { useMemo, useState, type ReactNode } from "react";
import type {
  Collectible,
  ForgeCommitDetailView,
  ForgeCommitListView,
  ForgeCommitSummary,
  ForgeFileBrowserView,
  ForgeIssueDetailView,
  ForgeIssueListView,
  ForgeRepoHome,
  ForgeUserProfileView,
  ForgeView,
  ForgeSignature,
} from "@iz/schema";
import { SafeAst } from "@iz/ui";
import { EmptyNote, GameLink, IdentityChip, ServiceFrame, shortDate } from "../shared/chrome.js";
import { openInGameLink } from "../shared/chrome.js";
import { unifiedDiff, wholeFileDiff, type FileDiff } from "./diff.js";

/**
 * GIT//FORGE (§10.2): honest 2010s-intranet repo hosting. Every view renders
 * exactly its ViewModel union member; every collectible view carries a Collect
 * button; select-then-press-C keeps working because these views keep the
 * view-level artifactId the browser collects against.
 */

/** Change record shape in the commit-detail VIEW MODEL (loose, not ForgeChange). */
interface ViewChange {
  path: string;
  kind: "add" | "modify" | "delete";
  before?: string;
  after?: string;
}

export interface ForgePageProps {
  view: ForgeView;
  host: string;
  collectibles: Collectible[];
  onCollect: (artifactId: string, label?: string) => void;
}

export function ForgePage({ view, host, collectibles, onCollect }: ForgePageProps): ReactNode {
  switch (view.view) {
    case "repo-home":
      return <RepoHome view={view} host={host} collectibles={collectibles} onCollect={onCollect} />;
    case "commit-list":
      return <CommitList view={view} host={host} collectibles={collectibles} onCollect={onCollect} />;
    case "commit-detail":
      return <CommitDetail view={view} host={host} collectibles={collectibles} onCollect={onCollect} />;
    case "file-browser":
      return <FileBrowser view={view} host={host} />;
    case "issue-list":
      return <IssueList view={view} host={host} collectibles={collectibles} onCollect={onCollect} />;
    case "issue-detail":
      return <IssueDetail view={view} host={host} collectibles={collectibles} onCollect={onCollect} />;
    case "user-profile":
      return <UserProfile view={view} host={host} collectibles={collectibles} onCollect={onCollect} />;
  }
}

/** Collect affordance for the page artifact, matched against server collectibles. */
function pageCollect(
  artifactId: string | null | undefined,
  collectibles: Collectible[]
): { artifactId: string; label: string } | undefined {
  if (artifactId === undefined || artifactId === null) return undefined;
  const match = collectibles.find((c) => c.artifactId === artifactId);
  return match !== undefined ? { artifactId: match.artifactId, label: match.label } : undefined;
}

function CommitRow({ commit, host, base }: {
  commit: ForgeCommitSummary;
  host: string;
  base: string;
}): ReactNode {
  return (
    <li>
      <div className="iz-row__main">
        <GameLink host={host} path={`${base}/commit/${commit.sha}`} ariaLabel={`Commit ${commit.sha.slice(0, 10)}: ${commit.message}`}>
          <code>{commit.sha.slice(0, 10)}</code>
        </GameLink>
        <span>{commit.message}</span>
      </div>
      <span className="iz-row__side">
        {commit.authorName} · <time dateTime={commit.date}>{shortDate(commit.date)}</time>
      </span>
    </li>
  );
}

/* --------------------------------- Repo home ------------------------------ */

function RepoHome({ view, host, collectibles, onCollect }: {
  view: ForgeRepoHome;
  host: string;
  collectibles: Collectible[];
  onCollect: (artifactId: string, label?: string) => void;
}): ReactNode {
  const base = `/${view.owner}/${view.name}`;
  const collect = pageCollect(view.artifactId, collectibles);
  return (
    <ServiceFrame
      brand="GIT//FORGE"
      host={host}
      crumbs={[
        { label: view.owner, path: `/users/${view.owner}` },
        { label: view.name },
      ]}
      collect={collect ? { ...collect, onCollect } : undefined}
    >
      <h1 style={{ marginTop: 4 }}>{view.name}</h1>
      <p className="iz-svc-meta">
        <span className="iz-badge iz-badge--accent">{view.defaultBranch}</span>{" "}
        <span style={{ color: "var(--iz-dim)" }}>{view.description}</span>
      </p>
      <p className="iz-svc-meta iz-svc-meta--mono">
        <GameLink host={host} path={`${base}/commits`}>commits</GameLink>
        {" · "}
        <GameLink host={host} path={`${base}/issues`}>issues</GameLink>
        {" · "}
        <GameLink host={host} path={`${base}/tree/${view.defaultBranch}`}>files</GameLink>
      </p>

      <h2>README</h2>
      <SafeAst node={view.readmeAst} onOpenLink={openInGameLink} />

      <h2>Recent commits</h2>
      {view.recentCommits.length === 0 ? (
        <EmptyNote>No commits yet.</EmptyNote>
      ) : (
        <ul className="iz-rows">
          {view.recentCommits.map((c) => (
            <CommitRow key={c.sha} commit={c} host={host} base={base} />
          ))}
        </ul>
      )}

      <h2>Open issues</h2>
      {view.openIssues.length === 0 ? (
        <EmptyNote>No open issues.</EmptyNote>
      ) : (
        <ul className="iz-rows">
          {view.openIssues.map((i) => (
            <li key={i.number}>
              <div className="iz-row__main">
                <GameLink host={host} path={`${base}/issues/${i.number}`} ariaLabel={`Issue ${i.number}: ${i.title}`}>
                  <span style={{ color: "var(--iz-faint)" }}>#{i.number}</span> {i.title}
                </GameLink>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ServiceFrame>
  );
}

/* -------------------------------- Commit list ----------------------------- */

function CommitList({ view, host, collectibles, onCollect }: {
  view: ForgeCommitListView;
  host: string;
  collectibles: Collectible[];
  onCollect: (artifactId: string, label?: string) => void;
}): ReactNode {
  const base = `/${view.owner}/${view.name}`;
  const authors = useMemo(() => [...new Set(view.commits.map((c) => c.authorName))].sort(), [view.commits]);
  const [author, setAuthor] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filtered = view.commits.filter((c) => {
    if (author !== "" && c.authorName !== author) return false;
    const day = c.date.slice(0, 10);
    if (fromDate !== "" && day < fromDate) return false;
    if (toDate !== "" && day > toDate) return false;
    return true;
  });

  return (
    <ServiceFrame
      brand="GIT//FORGE"
      host={host}
      crumbs={[{ label: view.owner }, { label: view.name, path: `/${view.owner}/${view.name}` }, { label: "commits" }]}
      collect={(() => {
        const c = pageCollect(view.artifactId, collectibles);
        return c ? { ...c, onCollect } : undefined;
      })()}
    >
      <h1 style={{ marginTop: 4 }}>Commits</h1>
      <div className="iz-filterbar">
        <label className="iz-filterbar__field">
          Author
          <select className="iz-input" value={author} onChange={(e) => setAuthor(e.target.value)}>
            <option value="">All authors</option>
            {authors.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="iz-filterbar__field">
          From date
          <input className="iz-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="iz-filterbar__field">
          To date
          <input className="iz-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        {(author !== "" || fromDate !== "" || toDate !== "") && (
          <button
            type="button"
            className="iz-btn iz-btn--quiet"
            onClick={() => {
              setAuthor("");
              setFromDate("");
              setToDate("");
            }}
          >
            Clear filters
          </button>
        )}
        <span className="iz-filterbar__field" style={{ justifyContent: "flex-end", flex: 1, textAlign: "right" }}>
          {filtered.length} of {view.commits.length} commits
        </span>
      </div>
      {filtered.length === 0 ? (
        <EmptyNote>No commits match these filters.</EmptyNote>
      ) : (
        <ul className="iz-rows">
          {filtered.map((c) => (
            <CommitRow key={c.sha} commit={c} host={host} base={base} />
          ))}
        </ul>
      )}
    </ServiceFrame>
  );
}

/* ------------------------------- Commit detail ---------------------------- */

function SignaturePanel({ signature }: { signature: ForgeSignature }): ReactNode {
  return (
    <div className={`iz-signaturepanel${signature.valid ? "" : " iz-signaturepanel--invalid"}`}>
      <div className="iz-signaturepanel__row">
        <strong style={{ color: "var(--iz-ink)" }}>{signature.signer}</strong>
        <span className={`iz-badge ${signature.valid ? "iz-badge--ok" : "iz-badge--bad"}`}>
          {signature.valid ? "signature VALID" : "signature INVALID"}
        </span>
      </div>
      <div className="iz-signaturepanel__row iz-signaturepanel__key">
        <span>key {signature.keyId}</span>
        <span>fp {signature.fingerprint}</span>
      </div>
    </div>
  );
}

function FragmentedHunk({ hunk, first }: { hunk: { beforeStart: number; afterStart: number; lines: Array<{ kind: string; text: string }> }; first: boolean }): ReactNode {
  return (
    <>
      {!first && (
        <tr>
          <td colSpan={2} style={{ borderTop: "1px solid var(--iz-line2)" }} />
        </tr>
      )}
      <tr className="iz-diff__line--hunk">
        <td className="iz-diff__sign">@</td>
        <td className="iz-diff__code">
          @@ -{hunk.beforeStart} +{hunk.afterStart} @@
        </td>
      </tr>
      {hunk.lines.map((line, i) => (
        <tr key={i} className={`iz-diff__line iz-diff__line--${line.kind}`}>
          <td className="iz-diff__sign">{line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}</td>
          <td className="iz-diff__code">{line.text}</td>
        </tr>
      ))}
    </>
  );
}

function ChangeDiff({ change }: { change: ViewChange }): ReactNode {
  const label = change.kind === "add" ? "added" : change.kind === "delete" ? "deleted" : "modified";
  return (
    <div className="iz-diff">
      <div className="iz-diff__file">
        {label} <code>{change.path}</code>
      </div>
      {change.kind === "add" && change.after !== undefined && <DiffBody diff={wholeFileDiff("add", change.after)} />}
      {change.kind === "delete" && change.before !== undefined && <DiffBody diff={wholeFileDiff("del", change.before)} />}
      {change.kind === "modify" && change.before !== undefined && change.after !== undefined && (
        <DiffBody diff={unifiedDiff(change.before, change.after)} />
      )}
    </div>
  );
}

function DiffBody({ diff }: { diff: FileDiff }): ReactNode {
  if (diff.empty) {
    return (
      <div style={{ padding: "6px 10px", color: "var(--iz-faint)", fontSize: 12 }}>no textual changes</div>
    );
  }
  return (
    <table className="iz-diff__table">
      <tbody>
        {diff.hunks.map((hunk, hi) => (
          <FragmentedHunk key={hi} hunk={hunk} first={hi === 0} />
        ))}
      </tbody>
    </table>
  );
}

function CommitDetail({ view, host, collectibles, onCollect }: {
  view: ForgeCommitDetailView;
  host: string;
  collectibles: Collectible[];
  onCollect: (artifactId: string, label?: string) => void;
}): ReactNode {
  const c = view.commit;
  const base = `/${view.owner}/${view.name}`;
  const collect = pageCollect(view.artifactId, collectibles);
  return (
    <ServiceFrame
      brand="GIT//FORGE"
      host={host}
      crumbs={[
        { label: view.owner },
        { label: view.name, path: `/${view.owner}/${view.name}` },
        { label: "commits", path: `${base}/commits` },
        { label: c.sha.slice(0, 10) },
      ]}
      collect={collect ? { ...collect, onCollect } : undefined}
    >
      <h1 style={{ marginTop: 4, fontSize: 17 }}>{c.message}</h1>
      <p className="iz-svc-meta iz-svc-meta--mono" style={{ wordBreak: "break-all" }}>
        commit {c.sha}
        <br />
        author {c.author.name} &lt;{c.author.email}&gt; · <time dateTime={c.date}>{c.date}</time>
        <br />
        committer {c.committer.name} @ {c.committer.host}
        {c.parents.length > 0 && (
          <>
            <br />
            parent{c.parents.length > 1 ? "s" : ""} {c.parents.join(", ")}
          </>
        )}
      </p>
      {c.signature !== undefined && <SignaturePanel signature={c.signature} />}

      <h2>Changes ({c.changes.length})</h2>
      {c.changes.map((change) => (
        <ChangeDiff key={`${change.kind}:${change.path}`} change={change} />
      ))}
    </ServiceFrame>
  );
}

/* ------------------------------- File browser ----------------------------- */

function CodePane({ content }: { content: string }): ReactNode {
  const lines = content.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return (
    <div className="iz-codepane">
      <table>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="iz-codepane__ln">{i + 1}</td>
              <td className="iz-codepane__code">{line}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileBrowser({ view, host }: { view: ForgeFileBrowserView; host: string }): ReactNode {
  const base = `/${view.owner}/${view.name}`;
  const treeBase = `${base}/tree/${view.ref}`;
  const segments = view.path === "" ? [] : view.path.split("/");
  const crumbs: Array<{ label: string; path?: string }> = [
    { label: view.owner },
    { label: view.name, path: base },
    { label: view.ref, path: treeBase },
  ];
  segments.forEach((segment, i) => {
    const prefix = segments.slice(0, i + 1).join("/");
    crumbs.push({ label: segment, path: i === segments.length - 1 ? undefined : `${treeBase}/${prefix}` });
  });

  const sortedEntries = [...view.entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const isDeletedFile = view.file !== null && view.file.content === "";
  const emptyDir = view.file === null && view.path !== "" && view.entries.length === 0;

  return (
    <ServiceFrame brand="GIT//FORGE" host={host} crumbs={crumbs}>
      {sortedEntries.length > 0 && (
        <ul className="iz-filetree">
          {sortedEntries.map((entry) => (
            <li key={entry.name}>
              <span className="iz-filetree__glyph" aria-hidden="true">{entry.kind === "dir" ? "▸" : " "}</span>
              <GameLink host={host} path={`${treeBase}/${view.path === "" ? "" : `${view.path}/`}${entry.name}`}>
                {entry.name}
                {entry.kind === "dir" ? "/" : ""}
              </GameLink>
            </li>
          ))}
        </ul>
      )}
      {emptyDir && <EmptyNote>Nothing at this path for {view.ref}.</EmptyNote>}

      {view.file !== null && (
        <>
          <h2 style={{ fontFamily: "var(--iz-font-mono)", fontSize: 14 }}>{view.file.path}</h2>
          {isDeletedFile ? (
            <div className="iz-tombstone">
              <strong>No content at this ref.</strong> The file may be empty, or it was deleted here —
              check an earlier commit to see its last state.
            </div>
          ) : (
            <CodePane content={view.file.content} />
          )}
        </>
      )}
    </ServiceFrame>
  );
}

/* --------------------------------- Issues --------------------------------- */

function IssueList({ view, host, collectibles, onCollect }: {
  view: ForgeIssueListView;
  host: string;
  collectibles: Collectible[];
  onCollect: (artifactId: string, label?: string) => void;
}): ReactNode {
  const base = `/${view.owner}/${view.name}`;
  const [stateFilter, setStateFilter] = useState<"all" | "open" | "closed">("all");
  const filtered = view.issues.filter((i) => stateFilter === "all" || i.state === stateFilter);
  const open = view.issues.filter((i) => i.state === "open").length;
  return (
    <ServiceFrame
      brand="GIT//FORGE"
      host={host}
      crumbs={[{ label: view.owner }, { label: view.name, path: `/${view.owner}/${view.name}` }, { label: "issues" }]}
      collect={(() => {
        const c = pageCollect(view.artifactId, collectibles);
        return c ? { ...c, onCollect } : undefined;
      })()}
    >
      <h1 style={{ marginTop: 4 }}>Issues</h1>
      <div className="iz-filterbar" role="group" aria-label="Filter issues by state">
        {(["all", "open", "closed"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className="iz-btn iz-btn--quiet"
            aria-pressed={stateFilter === s}
            onClick={() => setStateFilter(s)}
          >
            {s === "all" ? `All (${view.issues.length})` : `${s} (${s === "open" ? open : view.issues.length - open})`}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <EmptyNote>No issues here.</EmptyNote>
      ) : (
        <ul className="iz-rows">
          {filtered.map((i) => (
            <li key={i.number}>
              <div className="iz-row__main">
                <GameLink host={host} path={`${base}/issues/${i.number}`} ariaLabel={`Issue ${i.number}: ${i.title}`}>
                  <span style={{ color: "var(--iz-faint)" }}>#{i.number}</span> {i.title}
                </GameLink>
                <span className={`iz-badge ${i.state === "open" ? "iz-badge--accent" : ""}`}>{i.state}</span>
              </div>
              <span className="iz-row__side">
                <IdentityChip identity={i.author} /> · <time dateTime={i.date}>{shortDate(i.date)}</time> ·{" "}
                {i.commentCount} comment{i.commentCount === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ServiceFrame>
  );
}

function IssueDetail({ view, host, collectibles, onCollect }: {
  view: ForgeIssueDetailView;
  host: string;
  collectibles: Collectible[];
  onCollect: (artifactId: string, label?: string) => void;
}): ReactNode {
  const issue = view.issue;
  const base = `/${view.owner}/${view.name}`;
  return (
    <ServiceFrame
      brand="GIT//FORGE"
      host={host}
      crumbs={[
        { label: view.owner },
        { label: view.name, path: `/${view.owner}/${view.name}` },
        { label: "issues", path: `${base}/issues` },
        { label: `#${issue.number}` },
      ]}
      collect={(() => {
        const c = pageCollect(view.artifactId, collectibles);
        return c ? { ...c, onCollect } : undefined;
      })()}
    >
      <h1 style={{ marginTop: 4, fontSize: 17 }}>
        <span style={{ color: "var(--iz-faint)" }}>#{issue.number}</span> {issue.title}
      </h1>
      <p className="iz-svc-meta">
        <span className={`iz-badge ${issue.state === "open" ? "iz-badge--accent" : ""}`}>{issue.state}</span>{" "}
        opened by <IdentityChip identity={issue.author} /> · <time dateTime={issue.date}>{shortDate(issue.date)}</time>
      </p>
      <SafeAst node={issue.ast} onOpenLink={openInGameLink} />

      {issue.comments.length > 0 && (
        <>
          <h2>
            {issue.comments.length} comment{issue.comments.length === 1 ? "" : "s"}
          </h2>
          <ul className="iz-rows">
            {issue.comments.map((comment, i) => (
              <li key={i}>
                <div className="iz-row__main" style={{ marginBottom: 4 }}>
                  <IdentityChip identity={comment.author} />
                  <time dateTime={comment.date} style={{ color: "var(--iz-faint)", fontSize: 12 }}>
                    {shortDate(comment.date)}
                  </time>
                </div>
                <SafeAst node={comment.ast} onOpenLink={openInGameLink} />
              </li>
            ))}
          </ul>
        </>
      )}
    </ServiceFrame>
  );
}

/* ------------------------------- User profile ----------------------------- */

function UserProfile({ view, host, collectibles, onCollect }: {
  view: ForgeUserProfileView;
  host: string;
  collectibles: Collectible[];
  onCollect: (artifactId: string, label?: string) => void;
}): ReactNode {
  return (
    <ServiceFrame
      brand="GIT//FORGE"
      host={host}
      crumbs={[{ label: "users" }, { label: view.login }]}
      collect={(() => {
        const c = pageCollect(view.artifactId, collectibles);
        return c ? { ...c, onCollect } : undefined;
      })()}
    >
      <h1 style={{ marginTop: 4, fontFamily: "var(--iz-font-mono)" }}>{view.login}</h1>
      {view.deleted ? (
        <div className="iz-tombstone" role="note">
          <strong>Account deleted.</strong> This profile no longer exists; the name is kept only on
          the commits and issues it left behind.
        </div>
      ) : (
        <>
          {view.name !== null && <p style={{ margin: "0.2em 0", fontSize: 16 }}>{view.name}</p>}
          {view.bio !== null && <p style={{ color: "var(--iz-dim)" }}>{view.bio}</p>}
          {view.name === null && view.bio === null && <EmptyNote>No profile details.</EmptyNote>}
        </>
      )}

      {view.recentCommits.length > 0 && (
        <>
          <h2>Recent commits</h2>
          <ul className="iz-rows">
            {view.recentCommits.map((c) => (
              <li key={c.sha}>
                <div className="iz-row__main">
                  <code>{c.sha.slice(0, 10)}</code>
                  <span>{c.message}</span>
                </div>
                <span className="iz-row__side">
                  {c.authorName} · <time dateTime={c.date}>{shortDate(c.date)}</time>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {view.authoredIssues.length > 0 && (
        <>
          <h2>Authored issues</h2>
          <ul className="iz-rows">
            {view.authoredIssues.map((i) => (
              <li key={i.number}>
                <div className="iz-row__main">
                  <span style={{ color: "var(--iz-faint)" }}>#{i.number}</span> {i.title}
                  <span className={`iz-badge ${i.state === "open" ? "iz-badge--accent" : ""}`}>{i.state}</span>
                </div>
                <span className="iz-row__side">
                  <time dateTime={i.date}>{shortDate(i.date)}</time> · {i.commentCount} comment
                  {i.commentCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </ServiceFrame>
  );
}
