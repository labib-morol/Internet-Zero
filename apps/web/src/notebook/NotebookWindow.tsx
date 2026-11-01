import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Claim, EvidenceItem, Fragment } from "@iz/schema";
import { announce, useSessionStore } from "@iz/ui";
import { useArtifactTitle } from "./titles.js";
import "./notebook.css";

/**
 * The notebook (§11.2): the team's evidence and claims in one case log.
 *
 * Reads ONLY the session store (wire form) — evidence collected anywhere
 * (browser, terminal, a teammate) appears here live through the store's event
 * merge. All mutations go through dispatch(): archiving hides an item from
 * the board and this list while keeping it in the log (§7). The Private notes
 * tab shows private claims (state.claims with private:true); the server-side
 * private_notes table has no client surface in M1 and says so honestly.
 */

export interface NotebookWindowProps {
  /**
   * Integrator wiring for "Open source": open the item's provenance page in
   * the in-game browser (e.g. focus the browser window and navigate). When
   * absent the button is inert.
   */
  onOpenInBrowser?: (target: { host: string; path: string; artifactId: string }) => void;
}

type Tab = "case" | "private";
type TypeFilter = "all" | "evidence" | "claims";

function formatWhen(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

function fragmentLabel(fragment: Fragment | undefined): string | undefined {
  if (fragment === undefined) return undefined;
  switch (fragment.kind) {
    case "lines":
      return `lines ${fragment.from}–${fragment.to}`;
    case "range":
      return `chars ${fragment.start}–${fragment.end}`;
    case "region":
      return "image region";
  }
}

function sourceLabel(item: EvidenceItem): string {
  return `${item.provenance.host}${item.provenance.path}`;
}

function newestFirst(timeA: string, idA: string, timeB: string, idB: string): number {
  return timeB.localeCompare(timeA) || idA.localeCompare(idB);
}

interface EvidenceCardProps {
  item: EvidenceItem;
  canOpenSource: boolean;
  onOpenInBrowser: NotebookWindowProps["onOpenInBrowser"];
  onResolved: (id: string, title: string) => void;
}

/** One evidence item as a document card (§7: evidence is what they found). */
function EvidenceCard({ item, canOpenSource, onOpenInBrowser, onResolved }: EvidenceCardProps): ReactNode {
  const title = useArtifactTitle(item.provenance.host, item.provenance.path, item.artifactId);
  const dispatch = useSessionStore((s) => s.dispatch);
  const resolving = item.provenance.host !== "" && title === undefined;

  useEffect(() => {
    if (title !== undefined) onResolved(item.id, title);
  }, [title, item.id, onResolved]);

  const onArchive = useCallback(() => {
    const label = title ?? (sourceLabel(item) !== "" ? sourceLabel(item) : item.artifactId);
    void dispatch({ type: "archiveEvidence", evidenceId: item.id }).then(({ rejection }) => {
      if (rejection === undefined) announce(`Archived: ${label}`);
    });
  }, [dispatch, item, title]);

  const onOpen = useCallback(() => {
    onOpenInBrowser?.({ host: item.provenance.host, path: item.provenance.path, artifactId: item.artifactId });
  }, [onOpenInBrowser, item]);

  return (
    <article className="iz-nb__doc" data-testid={`notebook-evidence-${item.id}`}>
      <h3 className="iz-nb__doc-title">
        {title ?? (sourceLabel(item) !== "" ? sourceLabel(item) : item.artifactId)}
        {resolving && <span className="iz-visually-hidden"> (title loading)</span>}
      </h3>
      <p className="iz-nb__chips">
        {item.provenance.service !== "" && <span className="iz-chip">{item.provenance.service}</span>}
        {sourceLabel(item) !== "" && <span className="iz-chip">{sourceLabel(item)}</span>}
        {item.fragment !== undefined && <span className="iz-chip">{fragmentLabel(item.fragment)}</span>}
      </p>
      <p className="iz-nb__meta">
        artifact <span className="iz-nb__mono">{item.artifactId}</span>
        {" · collected "}
        {formatWhen(item.collectedAt)} by {item.collectedBy}
        {sourceLabel(item) === "" && " · source pending"}
      </p>
      <div className="iz-nb__actions">
        <button type="button" className="iz-btn" onClick={onArchive}>
          Archive
        </button>
        <button
          type="button"
          className="iz-btn iz-btn--quiet"
          onClick={onOpen}
          disabled={!canOpenSource || item.provenance.host === ""}
        >
          Open source
        </button>
      </div>
    </article>
  );
}

/** One claim as a note (§7: claims are what they think). */
function ClaimNote({ claim }: { claim: Claim }): ReactNode {
  return (
    <article className={`iz-nb__note${claim.private ? " iz-nb__note--private" : ""}`} data-testid={`notebook-claim-${claim.id}`}>
      <p className="iz-nb__note-text">{claim.text}</p>
      <p className="iz-nb__meta">
        {claim.private && "private · "}noted {formatWhen(claim.createdAt)} by {claim.createdBy}
      </p>
    </article>
  );
}

export function NotebookWindow({ onOpenInBrowser }: NotebookWindowProps): ReactNode {
  const evidence = useSessionStore((s) => s.state?.evidence);
  const claims = useSessionStore((s) => s.state?.claims);

  const [tab, setTab] = useState<Tab>("case");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [hostFilter, setHostFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [resolvedTitles, setResolvedTitles] = useState<Record<string, string>>({});

  const evidenceList = useMemo(
    () =>
      Object.values(evidence ?? {}).sort((a, b) =>
        newestFirst(a.collectedAt, a.id, b.collectedAt, b.id)
      ),
    [evidence]
  );
  const claimList = useMemo(
    () =>
      Object.values(claims ?? {}).sort((a, b) => newestFirst(a.createdAt, a.id, b.createdAt, b.id)),
    [claims]
  );

  const onResolved = useCallback((id: string, title: string) => {
    setResolvedTitles((prev) => (prev[id] === title ? prev : { ...prev, [id]: title }));
  }, []);

  const hosts = useMemo(() => {
    const set = new Set<string>();
    for (const item of evidenceList) {
      if (item.provenance.host !== "") set.add(item.provenance.host);
    }
    return [...set].sort();
  }, [evidenceList]);

  const q = query.trim().toLowerCase();

  const archivedCount = useMemo(() => evidenceList.filter((e) => e.archived).length, [evidenceList]);

  const caseEntries = useMemo(() => {
    const wantsEvidence = typeFilter === "all" || typeFilter === "evidence";
    const wantsClaims = typeFilter === "all" || typeFilter === "claims";
    const evidenceHits = wantsEvidence
      ? evidenceList.filter((e) => {
          if (e.archived) return false;
          if (hostFilter !== "all" && e.provenance.host !== hostFilter) return false;
          if (q === "") return true;
          const haystack = `${resolvedTitles[e.id] ?? ""} ${sourceLabel(e)} ${e.artifactId}`.toLowerCase();
          return haystack.includes(q);
        })
      : [];
    const claimHits = wantsClaims
      ? claimList.filter((c) => {
          if (c.private) return false;
          if (q === "") return true;
          return c.text.toLowerCase().includes(q);
        })
      : [];
    return [...evidenceHits, ...claimHits].sort((a, b) =>
      "collectedAt" in a
        ? "collectedAt" in b
          ? newestFirst(a.collectedAt, a.id, b.collectedAt, b.id)
          : newestFirst(a.collectedAt, a.id, b.createdAt, b.id)
        : "collectedAt" in b
          ? newestFirst(a.createdAt, a.id, b.collectedAt, b.id)
          : newestFirst(a.createdAt, a.id, b.createdAt, b.id)
    );
  }, [evidenceList, claimList, typeFilter, hostFilter, q, resolvedTitles]);

  const privateEntries = useMemo(
    () =>
      claimList.filter((c) => c.private && (q === "" || c.text.toLowerCase().includes(q))),
    [claimList, q]
  );

  const entries = tab === "case" ? caseEntries : privateEntries;

  return (
    <div className="iz-nb" data-view="notebook">
      <div className="iz-nb__tabs" role="tablist" aria-label="Notebook tabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "case"}
          className="iz-nb__tab"
          onClick={() => setTab("case")}
        >
          Case
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "private"}
          className="iz-nb__tab"
          onClick={() => setTab("private")}
        >
          Private notes
        </button>
      </div>

      <div className="iz-nb__toolbar">
        <input
          type="search"
          className="iz-input iz-nb__search"
          aria-label="Search the notebook"
          placeholder="Search titles and text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="iz-nb__seg" role="group" aria-label="Filter by type">
          {(["all", "evidence", "claims"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className="iz-nb__segbtn"
              aria-pressed={typeFilter === t}
              onClick={() => setTypeFilter(t)}
            >
              {t === "all" ? "All" : t === "evidence" ? "Evidence" : "Claims"}
            </button>
          ))}
        </div>
        <select
          className="iz-input iz-nb__host"
          aria-label="Filter by host"
          value={hostFilter}
          onChange={(e) => setHostFilter(e.target.value)}
        >
          <option value="all">All hosts</option>
          {hosts.map((host) => (
            <option key={host} value={host}>
              {host}
            </option>
          ))}
        </select>
      </div>

      {tab === "private" && (
        <p className="iz-nb__sync" role="note">
          Private notes live on the server and do not sync to the notebook yet. Private claims
          made in this session are shown below.
        </p>
      )}

      <ul className="iz-nb__list" aria-label={tab === "case" ? "Case notebook entries" : "Private claims"}>
        {entries.map((entry) => (
          <li key={entry.id} className="iz-nb__item">
            {"collectedAt" in entry ? (
              <EvidenceCard
                item={entry}
                canOpenSource={onOpenInBrowser !== undefined}
                onOpenInBrowser={onOpenInBrowser}
                onResolved={onResolved}
              />
            ) : (
              <ClaimNote claim={entry} />
            )}
          </li>
        ))}
      </ul>

      {entries.length === 0 && tab === "case" && (
        <div className="iz-nb__empty">
          {q !== "" || hostFilter !== "all" || typeFilter !== "all" ? (
            <p>Nothing matches the current filters.</p>
          ) : (
            <p>
              Nothing collected yet. Collect evidence in the browser — select text and press{" "}
              <span className="iz-kbd">C</span>, or use a Collect button.
            </p>
          )}
        </div>
      )}
      {entries.length === 0 && tab === "private" && (
        <div className="iz-nb__empty">
          {q !== "" ? (
            <p>Nothing matches the current search.</p>
          ) : (
            <p>Not synced yet — no private claims in this session.</p>
          )}
        </div>
      )}

      <p className="iz-nb__status" aria-live="polite">
        {tab === "case" && archivedCount > 0 && `${archivedCount} archived · `}
        {entries.length} shown
      </p>
    </div>
  );
}
