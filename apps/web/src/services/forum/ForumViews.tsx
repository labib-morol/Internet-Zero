import { type ReactNode } from "react";
import type { Collectible, ForumView, SafeNode } from "@iz/schema";
import { SafeAst } from "@iz/ui";
import { EmptyNote, GameLink, IdentityChip, ServiceFrame, shortDate } from "../shared/chrome.js";

/**
 * GHOSTBOARD UI (§10.7): board list, board threads, thread posts. Deleted
 * posts render as tombstones; edits show an edit counter, never the history
 * text (that is a separate artifact when the world authors one).
 */

export interface ForumPageProps {
  view: ForumView;
  host: string;
  collectibles: Collectible[];
  onCollect: (artifactId: string, label?: string) => void;
}

export function ForumPage({ view, host }: ForumPageProps): ReactNode {
  switch (view.view) {
    case "forum-board-list":
      return (
        <ServiceFrame brand="GHOSTBOARD" host={host} crumbs={[{ label: "boards" }]}>
          <h1 style={{ marginTop: 4 }}>Boards</h1>
          {view.boards.length === 0 ? (
            <EmptyNote>No boards on this host.</EmptyNote>
          ) : (
            <ul className="iz-rows">
              {view.boards.map((b) => (
                <li key={b.boardId}>
                  <div className="iz-row__main">
                    <GameLink host={host} path={`/${b.boardId}`}>{b.name}</GameLink>
                  </div>
                  <span className="iz-row__side">
                    {b.threads} thread{b.threads === 1 ? "" : "s"} · {b.posts} post{b.posts === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ServiceFrame>
      );
    case "forum-board":
      return (
        <ServiceFrame brand="GHOSTBOARD" host={host} crumbs={[{ label: "boards", path: "/" }, { label: view.boardName }]}>
          <h1 style={{ marginTop: 4 }}>{view.boardName}</h1>
          {view.threads.length === 0 ? (
            <EmptyNote>No threads yet.</EmptyNote>
          ) : (
            <ul className="iz-rows">
              {[...view.threads]
                .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastAt.localeCompare(a.lastAt))
                .map((t) => (
                  <li key={t.threadId}>
                    <div className="iz-row__main">
                      <GameLink host={host} path={`/${view.boardId}/${t.threadId}`} ariaLabel={`Thread: ${t.title}`}>
                        {t.pinned && <span className="iz-badge iz-badge--accent">pinned</span>} {t.title}
                      </GameLink>
                    </div>
                    <span className="iz-row__side">
                      {t.posts} post{t.posts === 1 ? "" : "s"} · <time dateTime={t.lastAt}>{shortDate(t.lastAt)}</time>
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </ServiceFrame>
      );
    case "forum-thread":
      return (
        <ServiceFrame
          brand="GHOSTBOARD"
          host={host}
          crumbs={[{ label: "boards", path: "/" }, { label: view.title }]}
        >
          <h1 style={{ marginTop: 4 }}>
            {view.pinned && <span className="iz-badge iz-badge--accent">pinned</span>} {view.title}
          </h1>
          {view.posts.map((post) => (
            <article
              key={post.artifactId}
              className="iz-nb__doc"
              style={post.deleted ? { opacity: 0.75, borderLeftColor: "var(--iz-faint)" } : undefined}
            >
              <p className="iz-nb__chips">
                <IdentityChip identity={post.author} />
                <time dateTime={post.at}>{shortDate(post.at)}</time>
                {post.edits > 0 && <span className="iz-chip">edited ×{post.edits}</span>}
                {post.deleted && <span className="iz-chip">deleted</span>}
              </p>
              {post.deleted ? (
                <p className="iz-nb__note-text" style={{ color: "var(--iz-faint)" }}>[post deleted]</p>
              ) : (
                <SafeAst node={post.ast as SafeNode} />
              )}
            </article>
          ))}
        </ServiceFrame>
      );
  }
}
