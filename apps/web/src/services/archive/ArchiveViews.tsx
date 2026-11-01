import { useState, type FormEvent, type ReactNode } from "react";
import type { ArchiveDocumentView, ArchiveSearchView, ArchiveView } from "@iz/schema";
import { SafeAst } from "@iz/ui";
import { useBrowserStore } from "../../browser/store.js";
import { EmptyNote, GameLink, ServiceFrame, shortDate } from "../shared/chrome.js";
import { openInGameLink } from "../shared/chrome.js";

/**
 * THE ARCHIVE (§10.4): document search and reader. The server builds the
 * search index and already drops invisible artifacts before ranking — the UI
 * renders only what arrives and never guesses at hidden counts. Removable
 * redactions in documents reveal only through "inspect layers".
 */

export interface ArchivePageProps {
  view: ArchiveView;
  host: string;
}

export function ArchivePage({ view, host }: ArchivePageProps): ReactNode {
  switch (view.view) {
    case "archive-search":
      return <SearchPage view={view} host={host} />;
    case "archive-document":
      return <DocumentPage view={view} host={host} />;
  }
}

/* ---------------------------------- Search -------------------------------- */

function SearchPage({ view, host }: { view: ArchiveSearchView; host: string }): ReactNode {
  const [query, setQuery] = useState(view.query);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed === "") return;
    void useBrowserStore.getState().navigate(host, `/search/${encodeURIComponent(trimmed)}`);
  };

  return (
    <ServiceFrame brand="THE ARCHIVE" host={host} crumbs={[{ label: "search" }]}>
      <h1 style={{ marginTop: 4 }}>Search the archive</h1>
      <form onSubmit={submit} className="iz-caseform" role="search" style={{ maxWidth: 460, marginBottom: 10 }}>
        <label className="iz-caseform__field">
          <span>Search documents</span>
          <div className="iz-caseform__row">
            <input
              className="iz-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="title, text, metadata…"
              aria-label="Archive search query"
            />
            <button type="submit" className="iz-btn iz-btn--primary">
              Search
            </button>
          </div>
        </label>
      </form>

      {view.query !== "" && (
        <p className="iz-svc-meta">
          Results for <code>{view.query}</code> — {view.results.length} document
          {view.results.length === 1 ? "" : "s"}
        </p>
      )}
      {view.query !== "" && view.results.length === 0 && <EmptyNote>Nothing matched that query.</EmptyNote>}
      <ul className="iz-rows">
        {view.results.map((r) => (
          <li key={r.artifactId}>
            <div className="iz-row__main">
              <GameLink host={host} path={`/documents/${r.artifactId}`} ariaLabel={`Document: ${r.title}`}>
                {r.title}
              </GameLink>
              <span className="iz-badge">{r.type}</span>
              <time dateTime={r.date} style={{ color: "var(--iz-faint)", fontSize: 12 }}>
                {shortDate(r.date)}
              </time>
            </div>
            <span className="iz-archive-result__snippet">{r.snippet}</span>
          </li>
        ))}
      </ul>
    </ServiceFrame>
  );
}

/* --------------------------------- Document ------------------------------- */

function DocumentPage({ view, host }: { view: ArchiveDocumentView; host: string }): ReactNode {
  const doc = view.doc;
  const [inspect, setInspect] = useState(false);
  const metaEntries = Object.entries(doc.meta);

  return (
    <ServiceFrame brand="THE ARCHIVE" host={host} crumbs={[{ label: "search", path: "/search" }, { label: doc.title }]}>
      <h1 style={{ marginTop: 4 }}>{doc.title}</h1>
      <p className="iz-svc-meta">
        <span className="iz-badge">{doc.type}</span> ·{" "}
        <time dateTime={doc.date}>{shortDate(doc.date)}</time> · source {doc.source}
      </p>

      {doc.removableRedactions > 0 && (
        <p>
          <button type="button" className="iz-btn iz-btn--quiet" aria-pressed={inspect} onClick={() => setInspect(!inspect)}>
            {inspect ? "Hide covered layers" : `Inspect layers (${doc.removableRedactions} covered)`}
          </button>
        </p>
      )}

      <SafeAst node={doc.ast} inspectLayers={inspect} onOpenLink={openInGameLink} />

      {metaEntries.length > 0 && (
        <details className="iz-metainspector">
          <summary>Metadata inspector</summary>
          <table>
            <caption className="iz-visually-hidden">Document metadata</caption>
            <tbody>
              {metaEntries.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td style={{ fontFamily: "var(--iz-font-mono)", fontSize: 12 }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {doc.assets.length > 0 && (
        <>
          <h2>Files</h2>
          <ul className="iz-rows">
            {doc.assets.map((asset) => (
              <li key={asset.assetId} style={{ borderBottom: "none" }}>
                <div className="iz-assetbox" role="img" aria-label={`Attached file: ${asset.label}`}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                    <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
                    <circle cx="5.5" cy="6" r="1.3" />
                    <path d="M2 12.5 6.5 8.5l3 3 2-2 2.5 2.5" />
                  </svg>
                  {asset.label}
                  <span style={{ marginLeft: "auto", fontSize: 11 }}>asset unavailable in this build</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </ServiceFrame>
  );
}
