import type { ReactNode } from "react";
import { useSessionStore } from "@iz/ui";

/**
 * "Case file" side panel (§11.1): solved gates, accepted report groups, hint
 * status and score, derived from team state.
 *
 * KNOWN LIMITATION (documented approximation): the world bundle (and with it
 * the list of ALL gates and which are still open) never reaches the client —
 * the server only ever sends view models and events. This panel therefore
 * shows gates the team has SOLVED (from GateSolved events), gates the team has
 * ATTEMPTED but not solved (AnswerRejected without a matching solve), accepted
 * report groups, and hint status. A true "open gates" list needs either a
 * bundle summary endpoint or solved/open info in the state wire — both are
 * server changes deliberately avoided tonight.
 */
export function CaseFilePanel({ onClose }: { onClose: () => void }): ReactNode {
  const state = useSessionStore((s) => s.state);
  const world = useSessionStore((s) => s.world);

  if (state === undefined) {
    return (
      <aside className="iz-casefile" aria-label="Case file">
        <div className="iz-casefile__head">
          <h2 className="iz-casefile__title">CASE FILE</h2>
        </div>
        <div className="iz-casefile__section">
          <p style={{ color: "var(--iz-faint)" }}>Loading case state…</p>
        </div>
      </aside>
    );
  }

  const solved = Object.entries(state.solvedGates).sort((a, b) => a[1].at.localeCompare(b[1].at));
  const solvedIds = new Set(solved.map(([id]) => id));
  const attempted = Object.keys(state.attempts).filter((id) => !solvedIds.has(id));
  const groups = Object.entries(state.reportGroupsAccepted);
  const hints = Object.entries(state.hintsUsed);
  const evidence = Object.values(state.evidence);
  const activeEvidence = evidence.filter((e) => !e.archived);

  return (
    <aside className="iz-casefile" aria-label="Case file">
      <div className="iz-casefile__head">
        <h2 className="iz-casefile__title">CASE FILE</h2>
        <p style={{ margin: 0, fontSize: 12, color: "var(--iz-faint)" }}>
          {world?.title ?? state.worldId}
        </p>
      </div>

      <div className="iz-casefile__section">
        <p className="iz-casefile__label">Score</p>
        <p style={{ margin: 0, fontFamily: "var(--iz-font-mono)", fontSize: 22, fontWeight: 700 }} aria-live="polite">
          {state.score}
        </p>
      </div>

      <div className="iz-casefile__section">
        <p className="iz-casefile__label">Solved gates ({solved.length})</p>
        {solved.length === 0 ? (
          <p style={{ margin: 0, color: "var(--iz-faint)", fontSize: 12.5 }}>
            None yet. Gates open as you find evidence and answer questions.
          </p>
        ) : (
          <ul className="iz-casefile__list">
            {solved.map(([id, solve]) => (
              <li key={id}>
                <span>{id}</span>
                <span>{solve.at.slice(11, 16)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {attempted.length > 0 && (
        <div className="iz-casefile__section">
          <p className="iz-casefile__label">Attempted, still open</p>
          <ul className="iz-casefile__list">
            {attempted.map((id) => (
              <li key={id}>
                <span>{id}</span>
                <span>{state.attempts[id]?.length ?? 0} tries</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="iz-casefile__section">
        <p className="iz-casefile__label">Accepted report groups</p>
        {groups.length === 0 ? (
          <p style={{ margin: 0, color: "var(--iz-faint)", fontSize: 12.5 }}>No reports accepted yet.</p>
        ) : (
          <ul className="iz-casefile__list">
            {groups.map(([reportId, accepted]) => (
              <li key={reportId}>
                <span>{reportId}</span>
                <span>{accepted.join(", ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="iz-casefile__section">
        <p className="iz-casefile__label">Hints used</p>
        {hints.length === 0 ? (
          <p style={{ margin: 0, color: "var(--iz-faint)", fontSize: 12.5 }}>None. Hints cost score.</p>
        ) : (
          <ul className="iz-casefile__list">
            {hints.map(([gateId, tier]) => (
              <li key={gateId}>
                <span>{gateId}</span>
                <span>tier {tier}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="iz-casefile__section">
        <p className="iz-casefile__label">Evidence</p>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--iz-dim)" }}>
          {activeEvidence.length} item{activeEvidence.length === 1 ? "" : "s"} active
          {evidence.length !== activeEvidence.length && ` · ${evidence.length - activeEvidence.length} archived`}
        </p>
      </div>

      <div className="iz-casefile__section" style={{ marginTop: "auto" }}>
        <button type="button" className="iz-btn iz-btn--quiet" onClick={onClose} aria-label="Close case file panel">
          Close panel
        </button>
      </div>
    </aside>
  );
}
