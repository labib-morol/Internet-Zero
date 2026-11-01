import type { ReactNode } from "react";
import type { NotFound, ViewModel } from "@iz/schema";
import type { Collectible } from "./store.js";
import { ForgePage } from "../services/forge/ForgeViews.js";
import { MailPage } from "../services/mail/MailViews.js";
import { ArchivePage } from "../services/archive/ArchiveViews.js";
import { TerminalSessionPage } from "../services/terminal/TerminalWindow.js";
import "../services/services.css";

/**
 * In-game page renderer (§10): every ViewModel union member gets its
 * per-service UI (M1 tasks 4–7). The notFound page stays here — it must
 * NOT reveal whether a host exists (§10.1), so unknown and locked hosts
 * render the exact same text. Select-then-press-C collect keeps working for
 * every view that carries an artifactId (forge commits/issues, mail messages,
 * archive documents): the browser window owns that gesture.
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
    <div className="iz-page" style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <ViewBody view={view} host={host} collectibles={collectibles} onCollect={onCollect} />
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

function ViewBody({ view, host, collectibles, onCollect }: {
  view: RenderableView;
  host: string;
  collectibles: Collectible[];
  onCollect: (artifactId: string, label?: string) => void;
}): ReactNode {
  switch (view.view) {
    case "repo-home":
    case "commit-list":
    case "commit-detail":
    case "file-browser":
    case "issue-list":
    case "issue-detail":
    case "user-profile":
      return <ForgePage view={view} host={host} collectibles={collectibles} onCollect={onCollect} />;
    case "mailbox":
    case "thread":
    case "message":
      return <MailPage view={view} host={host} collectibles={collectibles} onCollect={onCollect} />;
    case "archive-search":
    case "archive-document":
      return <ArchivePage view={view} host={host} />;
    case "terminal":
      return <TerminalSessionPage view={view} />;
    default:
      return <NoRendererYet />;
  }
}

function NoRendererYet(): ReactNode {
  return (
    <div className="iz-doc">
      <p>This page type has no renderer yet.</p>
    </div>
  );
}
