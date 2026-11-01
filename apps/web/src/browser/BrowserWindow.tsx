import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { announce, useSessionStore } from "@iz/ui";
import { currentEntry, formatAddress, useBrowserStore } from "./store.js";
import { rangeFragment, selectionRangeIn } from "./selection.js";
import { ViewRenderer } from "./ViewRenderer.js";

/**
 * The in-game browser (§10.1). Address bar, back/forward, bookmarks — all
 * client state; no real navigation ever happens (this module must never touch
 * window.location). Content is the server's view model rendered by
 * ViewRenderer. Selecting text and pressing C collects it as evidence.
 */

export function BrowserWindow(): ReactNode {
  const entry = useBrowserStore(currentEntry);
  const index = useBrowserStore((s) => s.index);
  const count = useBrowserStore((s) => s.entries.length);
  const load = useBrowserStore((s) => s.load);
  const view = useBrowserStore((s) => s.view);
  const collectibles = useBrowserStore((s) => s.collectibles);
  const bookmarks = useBrowserStore((s) => s.bookmarks);
  const error = useBrowserStore((s) => s.error);
  const navigate = useBrowserStore((s) => s.navigate);
  const back = useBrowserStore((s) => s.back);
  const forward = useBrowserStore((s) => s.forward);
  const toggleBookmark = useBrowserStore((s) => s.toggleBookmark);
  const goToAddress = useBrowserStore((s) => s.goToAddress);
  const collect = useBrowserStore((s) => s.collect);
  const collectSelection = useBrowserStore((s) => s.collectSelection);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const [address, setAddress] = useState(entry !== undefined ? formatAddress(entry) : "");
  const [showBookmarks, setShowBookmarks] = useState(false);

  // Keep the address bar in sync when history moves (back/forward/links).
  useEffect(() => {
    setAddress(entry !== undefined ? formatAddress(entry) : "");
  }, [index, count, entry?.host, entry?.path]);

  const onAddressKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void goToAddress(address);
  };

  // Select-then-press-C collect (§11.1). Plain "c"/"C" with no modifiers and
  // outside any input; requires a non-collapsed selection inside the page.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "c" && event.key !== "C") return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select") !== null) return;
    const selection = window.getSelection();
    const container = contentRef.current;
    if (selection === null || container === null) return;
    const range = selectionRangeIn(container, selection);
    if (range === undefined) return;
    event.preventDefault();
    void collectSelection(rangeFragment(range)).then((ok) => {
      if (!ok) announce("Nothing collectible in that selection.", true);
    });
  };

  const bookmarked =
    entry !== undefined && bookmarks.some((b) => b.host === entry.host && b.path === entry.path);

  // Per-service skin (§11.4): the world's host table (WorldSummary.hosts,
  // DECISIONS D20) tells us the service behind the current host; the matching
  // skin class tints the toolbar and document links. Older servers may omit
  // the field — treat it as absent.
  const world = useSessionStore((s) => s.world);
  const serviceSkin = (() => {
    if (entry === undefined || world === undefined) return "";
    const host = world.hosts?.find((h) => h.host === entry.host);
    const service = host?.service ?? "";
    return ["forge", "mail", "archive", "terminal", "forum"].includes(service)
      ? `iz-skin-${service}`
      : "";
  })();

  return (
    <div className="iz-browser" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div className="iz-toolbar" role="toolbar" aria-label="Browser controls">
        <button type="button" className="iz-toolbar__btn" aria-label="Back" disabled={index <= 0} onClick={() => void back()}>
          ←
        </button>
        <button
          type="button"
          className="iz-toolbar__btn"
          aria-label="Forward"
          disabled={index >= count - 1}
          onClick={() => void forward()}
        >
          →
        </button>
        <div className="iz-address">
          <label className="iz-visually-hidden" htmlFor="iz-address-input">
            In-game address
          </label>
          <span aria-hidden="true" style={{ color: "var(--iz-faint)" }}>
            {"@"}
          </span>
          <input
            id="iz-address-input"
            className="iz-address__input"
            value={address}
            spellCheck={false}
            autoComplete="off"
            placeholder="host/path"
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={onAddressKeyDown}
          />
        </div>
        <button
          type="button"
          className="iz-toolbar__btn"
          aria-label={bookmarked ? "Remove bookmark" : "Bookmark this page"}
          aria-pressed={bookmarked}
          disabled={entry === undefined}
          onClick={toggleBookmark}
        >
          {bookmarked ? "★" : "☆"}
        </button>
        <button
          type="button"
          className="iz-toolbar__btn"
          aria-label="Show bookmarks"
          aria-expanded={showBookmarks}
          onClick={() => setShowBookmarks(!showBookmarks)}
        >
          ☰
        </button>
      </div>

      {showBookmarks && (
        <ul className="iz-bookmarks" aria-label="Bookmarks" style={{ listStyle: "none", margin: 0, padding: "6px 10px", borderBottom: "1px solid var(--iz-line)", background: "var(--iz-bg0)" }}>
          {bookmarks.length === 0 && (
            <li style={{ color: "var(--iz-faint)", fontSize: 12.5 }}>No bookmarks yet. Mark pages with the star.</li>
          )}
          {bookmarks.map((b) => (
            <li key={`${b.host}${b.path}`}>
              <a
                href="#"
                className="iz-doclink"
                onClick={(e) => {
                  e.preventDefault();
                  setShowBookmarks(false);
                  void navigate(b.host, b.path);
                }}
              >
                {formatAddress(b)}
              </a>
            </li>
          ))}
        </ul>
      )}

      <div
        ref={contentRef}
        className={`iz-browser__content ${serviceSkin}`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        aria-label="Page content. Select text and press C to collect it as evidence."
        style={{ flex: 1, minHeight: 0, overflow: "auto", outline: "none" }}
      >
        {load === "error" && (
          <div className="iz-doc">
            <h1>Connection problem</h1>
            <p>The page could not be loaded: {error}</p>
          </div>
        )}
        {load !== "error" && entry === undefined && (
          <div className="iz-doc">
            <h1>Where to?</h1>
            <p>
              Type an address above. The network directory window lists hosts your team can reach.
            </p>
          </div>
        )}
        {entry !== undefined && view !== undefined && (
          <ViewRenderer
            view={view}
            collectibles={collectibles}
            host={entry.host}
            onCollect={(artifactId, label) => void collect(artifactId, label)}
          />
        )}
        {entry !== undefined && view === undefined && load !== "error" && (
          <div className="iz-doc" aria-live="polite">
            <p style={{ color: "var(--iz-faint)" }}>Loading…</p>
          </div>
        )}
      </div>
    </div>
  );
}
