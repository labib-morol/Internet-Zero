import { Fragment, useState, type ReactNode } from "react";
import type {
  Collectible,
  MailAttachment,
  MailboxView,
  MailMessageView,
  MailThreadSummary,
  MailThreadView,
  MailView,
} from "@iz/schema";
import { SafeAst } from "@iz/ui";
import { EmptyNote, GameLink, IdentityChip, ServiceFrame, shortDate } from "../shared/chrome.js";
import { openInGameLink } from "../shared/chrome.js";

/**
 * DEADLETTER (§10.3): mail reader with folders, threads, identity chips,
 * "view source" header panels and the "inspect layers" tool — removable
 * redactions reveal only through an explicit user action, never by default.
 * Inspected messages stay revealed for the rest of the session.
 */

export interface MailPageProps {
  view: MailView;
  host: string;
  collectibles: Collectible[];
  onCollect: (artifactId: string, label?: string) => void;
}

/** Session-lifetime record of messages whose covered layers were inspected. */
const inspectedThisSession = new Set<string>();

export function MailPage({ view, host, collectibles, onCollect }: MailPageProps): ReactNode {
  switch (view.view) {
    case "mailbox":
      return <MailboxPage view={view} host={host} />;
    case "thread":
      return <ThreadPage view={view} host={host} collectibles={collectibles} onCollect={onCollect} />;
    case "message":
      return (
        <ServiceFrame brand="DEADLETTER" host={host} crumbs={[{ label: view.mailboxId, path: `/${view.mailboxId}` }, { label: "message" }]}>
          <MessageCard message={view.message} />
        </ServiceFrame>
      );
  }
}

/* --------------------------------- Mailbox -------------------------------- */

/**
 * The server folds every visible folder into one thread list; individual
 * threads may carry a `folder` marker beyond the schema (a mailbox view is the
 * aggregate). Tabs filter on that marker when present and degrade to a single
 * unfiltered list when not.
 */
function threadFolder(thread: MailThreadSummary): string | undefined {
  const marker = (thread as { folder?: unknown }).folder;
  return typeof marker === "string" ? marker : undefined;
}

function MailboxPage({ view, host }: { view: MailboxView; host: string }): ReactNode {
  const folders = useMemoFolders(view);
  const [active, setActive] = useState<string>("all");
  const threads = view.threads
    .filter((t) => active === "all" || threadFolder(t) === active)
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));

  return (
    <ServiceFrame
      brand="DEADLETTER"
      host={host}
      crumbs={[{ label: view.mailboxId }]}
    >
      <h1 style={{ marginTop: 4 }}>Mailbox “{view.mailboxId}”</h1>
      <div className="iz-filterbar" role="group" aria-label="Mail folders">
        {(["all", ...folders] as const).map((folder) => (
          <button
            key={folder}
            type="button"
            className="iz-btn iz-btn--quiet"
            aria-pressed={active === folder}
            onClick={() => setActive(folder)}
          >
            {folder}
            {folder !== "all" && folder === view.folder ? " (current)" : ""}
          </button>
        ))}
      </div>
      {threads.length === 0 ? (
        <EmptyNote>No messages in this folder.</EmptyNote>
      ) : (
        <ul className="iz-rows">
          {threads.map((t, i) => (
            <MailboxRow key={`${t.threadId ?? "solo"}-${i}`} thread={t} host={host} mailboxId={view.mailboxId} />
          ))}
        </ul>
      )}
    </ServiceFrame>
  );
}

function useMemoFolders(view: MailboxView): string[] {
  const seen: string[] = [];
  for (const t of view.threads) {
    const folder = threadFolder(t);
    if (folder !== undefined && !seen.includes(folder)) seen.push(folder);
  }
  return seen.sort();
}

function MailboxRow({ thread, host, mailboxId }: { thread: MailThreadSummary; host: string; mailboxId: string }): ReactNode {
  // Threads with a thread id open the whole conversation. Solo messages (no
  // thread id) cannot be deep-linked from the summary — the schema carries no
  // message id there — so the subject stays plain text; the mailbox root and
  // thread routes remain the honest navigation paths.
  const path = thread.threadId !== null ? `/${mailboxId}/thread/${thread.threadId}` : undefined;
  return (
    <li>
      <div className="iz-row__main">
        {path !== undefined ? (
          <GameLink host={host} path={path} ariaLabel={`Thread: ${thread.subject}`}>
            {thread.subject}
          </GameLink>
        ) : (
          thread.subject
        )}
      </div>
      <span className="iz-row__side" style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
        {thread.participants.map((p, i) => (
          <IdentityChip key={`${p.identityId}-${i}`} identity={p} />
        ))}
        · {thread.messageCount} message{thread.messageCount === 1 ? "" : "s"} ·{" "}
        <time dateTime={thread.lastDate}>{shortDate(thread.lastDate)}</time>
      </span>
    </li>
  );
}

/* ---------------------------------- Thread -------------------------------- */

function ThreadPage({ view, host, collectibles, onCollect }: {
  view: MailThreadView;
  host: string;
  collectibles: Collectible[];
  onCollect: (artifactId: string, label?: string) => void;
}): ReactNode {
  const collect = collectibles.find((c) => c.artifactId === view.messages[0]?.artifactId);
  return (
    <ServiceFrame
      brand="DEADLETTER"
      host={host}
      crumbs={[{ label: view.mailboxId, path: `/${view.mailboxId}` }, { label: view.subject }]}
      collect={collect ? { artifactId: collect.artifactId, label: collect.label, onCollect } : undefined}
    >
      <h1 style={{ marginTop: 4 }}>{view.subject}</h1>
      <p className="iz-svc-meta">
        {view.messages.length} message{view.messages.length === 1 ? "" : "s"} ·{" "}
        {view.messages[0] !== undefined && <time dateTime={view.messages[0].date}>{shortDate(view.messages[0].date)}</time>}
        {" → "}
        {view.messages.length > 0 && (
          <time dateTime={view.messages[view.messages.length - 1]!.date}>
            {shortDate(view.messages[view.messages.length - 1]!.date)}
          </time>
        )}
      </p>
      {view.messages.map((message) => (
        <MessageCard key={message.artifactId} message={message} />
      ))}
    </ServiceFrame>
  );
}

/* ---------------------------------- Message ------------------------------- */

function MessageCard({ message }: { message: MailMessageView }): ReactNode {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [inspect, setInspect] = useState(() => inspectedThisSession.has(message.artifactId));
  const inspectable = message.attachments.some((a) => a.hasRemovableRedactions);

  const toggleInspect = (): void => {
    setInspect((prev) => {
      const next = !prev;
      if (next) inspectedThisSession.add(message.artifactId);
      else inspectedThisSession.delete(message.artifactId);
      return next;
    });
  };

  const headerLines = Object.entries(message.headers).map(([k, v]) => `${k}: ${v}`);

  return (
    <section className="iz-mailmsg" aria-label={`Message: ${message.subject}`}>
      <header className="iz-mailmsg__head">
        <h2 className="iz-mailmsg__subject">{message.subject}</h2>
        <div className="iz-mailmsg__route">
          <span>from</span>
          <IdentityChip identity={message.from} />
          {message.to.length > 0 && (
            <>
              <span>to</span>
              {message.to.map((t, i) => (
                <Fragment key={`to-${t.identityId}-${i}`}>
                  {i > 0 && <span aria-hidden="true">,</span>}
                  <IdentityChip identity={t} />
                </Fragment>
              ))}
            </>
          )}
          {message.cc.length > 0 && (
            <>
              <span>cc</span>
              {message.cc.map((c, i) => (
                <Fragment key={`cc-${c.identityId}-${i}`}>
                  {i > 0 && <span aria-hidden="true">,</span>}
                  <IdentityChip identity={c} />
                </Fragment>
              ))}
            </>
          )}
        </div>
        <time dateTime={message.date} style={{ display: "block", marginTop: 3, fontSize: 12, color: "var(--iz-faint)" }}>
          {message.date}
        </time>
      </header>

      <div className="iz-mailmsg__body">
        <SafeAst node={message.ast} inspectLayers={inspect} onOpenLink={openInGameLink} />
      </div>

      {(message.attachments.length > 0 || headerLines.length > 0 || inspectable) && (
        <footer className="iz-mailmsg__tools">
          {message.attachments.length > 0 && (
            <ul className="iz-attachlist" style={{ flex: 1 }}>
              {message.attachments.map((a) => (
                <AttachmentRow key={a.assetId} attachment={a} inspected={inspect} onInspect={toggleInspect} />
              ))}
            </ul>
          )}
          {inspectable && (
            <button type="button" className="iz-btn iz-btn--quiet" aria-pressed={inspect} onClick={toggleInspect}>
              {inspect ? "Hide covered layers" : "Inspect layers"}
            </button>
          )}
          {headerLines.length > 0 && (
            <button
              type="button"
              className="iz-btn iz-btn--quiet"
              aria-expanded={sourceOpen}
              onClick={() => setSourceOpen(!sourceOpen)}
            >
              {sourceOpen ? "Hide source" : "View source"}
            </button>
          )}
        </footer>
      )}

      {sourceOpen && headerLines.length > 0 && (
        <pre className="iz-mailmsg__source" aria-label="Raw message headers">
          {headerLines.join("\n")}
        </pre>
      )}
    </section>
  );
}

function AttachmentRow({ attachment, inspected, onInspect }: {
  attachment: MailAttachment;
  inspected: boolean;
  onInspect: () => void;
}): ReactNode {
  return (
    <li>
      <span className="iz-attachlist__name">{attachment.filename}</span>
      {attachment.hasRemovableRedactions ? (
        <>
          <span className="iz-badge iz-badge--accent">covered layers</span>
          <button
            type="button"
            className="iz-btn iz-btn--quiet"
            aria-pressed={inspected}
            onClick={onInspect}
            aria-label={`Inspect layers of ${attachment.filename}`}
          >
            {inspected ? "layers revealed" : "inspect layers"}
          </button>
        </>
      ) : (
        <span style={{ color: "var(--iz-faint)", fontSize: 11.5 }}>no covered layers</span>
      )}
    </li>
  );
}
