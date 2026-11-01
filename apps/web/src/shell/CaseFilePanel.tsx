import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { CaseFileResponse } from "@iz/schema";
import { announce, useSessionStore } from "@iz/ui";
import { fetchCaseFile } from "../services/case/case-api.js";

/**
 * "Case file" side panel (§11.1): open gates with answer + hint flows, the
 * "Open reports" section (report slot forms fed by GET /api/case — the client
 * never sees report ANSWERS, only slot definitions), accepted report groups,
 * hint status and score, derived from team state + the server projection.
 *
 * Data sources (frozen REST contract + /api/case, M1 task 8):
 * - GET /api/case → {openGates: [{gateId, title}], reports: [{reportId,
 *   title, groups: [{id, slots: [{id, label, type, options?, fact}]}]}]}.
 * - dispatch submitAnswer → GateSolved / AnswerRejected (rate-limits included).
 * - dispatch submitReport → ReportGroupAccepted (which groups accepted ONLY,
 *   §8 — never which individual slots were wrong) / ReportRejected.
 * - dispatch requestHint → result {gateId, tier, text, cost} (tier n requires
 *   tier n-1; costs are deducted server-side and mirrored into score).
 */

type Feedback = { kind: "ok" | "bad"; text: string };

interface HintView {
  tier: 1 | 2 | 3;
  text: string;
  cost: number;
}

export function CaseFilePanel({ onClose }: { onClose: () => void }): ReactNode {
  const state = useSessionStore((s) => s.state);
  const world = useSessionStore((s) => s.world);
  const dispatch = useSessionStore((s) => s.dispatch);

  const [caseData, setCaseData] = useState<CaseFileResponse | undefined>(undefined);
  const [caseError, setCaseError] = useState<string | undefined>(undefined);
  const [caseLoading, setCaseLoading] = useState(false);

  // Per-target local UI state (answers, feedback, requested hints).
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [gateFeedback, setGateFeedback] = useState<Record<string, Feedback>>({});
  const [hints, setHints] = useState<Record<string, HintView[]>>({});
  const [reportSlots, setReportSlots] = useState<Record<string, string>>({});
  const [reportFeedback, setReportFeedback] = useState<Record<string, Feedback>>({});

  const solvedCount = Object.keys(state?.solvedGates ?? {}).length;
  const score = state?.score;

  const loadCase = useCallback(async (): Promise<void> => {
    setCaseLoading(true);
    try {
      const data = await fetchCaseFile();
      setCaseData(data);
      setCaseError(undefined);
    } catch (error) {
      setCaseError(error instanceof Error ? error.message : "The case file could not be loaded.");
    } finally {
      setCaseLoading(false);
    }
  }, []);

  // Initial load + reload whenever progress changes (new gates open, reports
  // get accepted). loadCase only sets local state, so this cannot loop.
  useEffect(() => {
    void loadCase();
  }, [loadCase, solvedCount, score]);

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
  const activeEvidence = Object.values(state.evidence).filter((e) => !e.archived);
  const openGates = caseData?.openGates ?? [];
  const reports = caseData?.reports ?? [];

  const submitAnswer = async (gateId: string): Promise<void> => {
    const answer = (answers[gateId] ?? "").trim();
    if (answer === "") {
      setGateFeedback((f) => ({ ...f, [gateId]: { kind: "bad", text: "Type an answer first." } }));
      return;
    }
    const response = await dispatch({ type: "submitAnswer", gateId, answer });
    setAnswers((a) => ({ ...a, [gateId]: "" }));
    if (response.rejection !== undefined) {
      const retry = response.rejection.retryAfterSeconds;
      setGateFeedback((f) => ({
        ...f,
        [gateId]: {
          kind: "bad",
          text: `${response.rejection!.message}${retry !== undefined ? ` Wait ${retry}s.` : ""}`,
        },
      }));
      return;
    }
    setGateFeedback((f) => ({ ...f, [gateId]: { kind: "ok", text: "Correct — gate solved." } }));
    announce(`Gate solved: ${gateId}.`);
    void loadCase();
  };

  const requestHint = async (gateId: string, tier: 1 | 2 | 3): Promise<void> => {
    const response = await dispatch({ type: "requestHint", gateId, tier });
    if (response.rejection !== undefined) {
      setGateFeedback((f) => ({ ...f, [gateId]: { kind: "bad", text: `Hint: ${response.rejection!.message}` } }));
      return;
    }
    const result = response.result as { gateId?: string; tier?: number; text?: string; cost?: number } | undefined;
    if (result?.text === undefined) return;
    const hint: HintView = {
      tier: (result.tier ?? tier) as 1 | 2 | 3,
      text: result.text,
      cost: result.cost ?? 0,
    };
    setHints((h) => {
      const existing = h[gateId] ?? [];
      if (existing.some((x) => x.tier === hint.tier)) return h;
      return { ...h, [gateId]: [...existing, hint].sort((a, b) => a.tier - b.tier) };
    });
    announce(`Hint tier ${hint.tier} for ${gateId} (−${hint.cost} points).`);
  };

  const submitReportGroup = async (reportId: string, groupId: string): Promise<void> => {
    const slots: Record<string, string> = {};
    for (const [key, value] of Object.entries(reportSlots)) {
      if (key.startsWith(`${reportId}:${groupId}:`) && value.trim() !== "") {
        slots[key.split(":")[2]!] = value.trim();
      }
    }
    const response = await dispatch({ type: "submitReport", reportId, groupId, slots });
    if (response.rejection !== undefined) {
      // §8: the response says only that the group was rejected — never which
      // slot was wrong.
      setReportFeedback((f) => ({
        ...f,
        [`${reportId}:${groupId}`]: { kind: "bad", text: "Not accepted — one or more fields are incorrect." },
      }));
      return;
    }
    setReportFeedback((f) => ({ ...f, [`${reportId}:${groupId}`]: { kind: "ok", text: "Group accepted." } }));
    announce(`Report group accepted: ${groupId}.`);
    void loadCase();
  };

  const onReportSlot = (key: string, value: string): void => {
    setReportSlots((s) => ({ ...s, [key]: value }));
  };

  const onReportSubmit = (event: FormEvent, reportId: string, groupId: string): void => {
    event.preventDefault();
    void submitReportGroup(reportId, groupId);
  };

  const onGateSubmit = (event: FormEvent, gateId: string): void => {
    event.preventDefault();
    void submitAnswer(gateId);
  };

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
        <div className="iz-casefile__gatehead">
          <p className="iz-casefile__label" style={{ margin: 0 }}>
            Open gates ({openGates.length})
          </p>
          <button
            type="button"
            className="iz-btn iz-btn--quiet"
            style={{ padding: "1px 8px", fontSize: 11.5 }}
            onClick={() => void loadCase()}
            disabled={caseLoading}
          >
            {caseLoading ? "…" : "Refresh"}
          </button>
        </div>
        {caseError !== undefined && (
          <p className="iz-caseform__feedback iz-caseform__feedback--bad" role="status">
            {caseError}
          </p>
        )}
        {caseError === undefined && openGates.length === 0 && !caseLoading && (
          <p style={{ margin: 0, color: "var(--iz-faint)", fontSize: 12.5 }}>
            None open right now. New questions appear as evidence opens doors.
          </p>
        )}
        {openGates.map((gate) => (
          <OpenGateCard
            key={gate.gateId}
            gate={gate}
            answer={answers[gate.gateId] ?? ""}
            onAnswer={(value) => setAnswers((a) => ({ ...a, [gate.gateId]: value }))}
            onSubmit={(event) => onGateSubmit(event, gate.gateId)}
            feedback={gateFeedback[gate.gateId]}
            hints={hints[gate.gateId] ?? []}
            usedTier={state.hintsUsed[gate.gateId] ?? 0}
            onRequestHint={(tier) => void requestHint(gate.gateId, tier)}
          />
        ))}
      </div>

      <div className="iz-casefile__section">
        <p className="iz-casefile__label">Open reports</p>
        {reports.length === 0 ? (
          <p style={{ margin: 0, color: "var(--iz-faint)", fontSize: 12.5 }}>
            No report forms are available yet.
          </p>
        ) : (
          reports.map((report) => {
            const accepted = state.reportGroupsAccepted[report.reportId] ?? [];
            const openGroups = report.groups.filter((g) => !accepted.includes(g.id));
            return (
              <div key={report.reportId} style={{ marginBottom: 10 }}>
                <p style={{ margin: "0 0 4px", fontSize: 12.5, fontWeight: 600 }}>{report.title}</p>
                {accepted.length > 0 && (
                  <p style={{ margin: "0 0 4px", fontSize: 11.5, color: "var(--iz-ok)" }}>
                    Accepted: {accepted.join(", ")}
                  </p>
                )}
                {openGroups.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 11.5, color: "var(--iz-faint)" }}>Every group is accepted.</p>
                ) : (
                  openGroups.map((group) => (
                    <form
                      key={group.id}
                      className="iz-caseform"
                      onSubmit={(event) => onReportSubmit(event, report.reportId, group.id)}
                      aria-label={`Report group ${group.id} of ${report.title}`}
                    >
                      {group.slots.map((slot) => {
                        const key = `${report.reportId}:${group.id}:${slot.id}`;
                        const value = reportSlots[key] ?? "";
                        return (
                          <label className="iz-caseform__field" key={slot.id}>
                            <span>{slot.label}</span>
                            {slot.type === "choice" && slot.options !== undefined ? (
                              <select className="iz-input" value={value} onChange={(e) => onReportSlot(key, e.target.value)}>
                                <option value="">Choose…</option>
                                {slot.options.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                className="iz-input"
                                type="text"
                                value={value}
                                placeholder={slot.type === "date" ? "YYYY-MM-DD" : undefined}
                                onChange={(e) => onReportSlot(key, e.target.value)}
                              />
                            )}
                          </label>
                        );
                      })}
                      <div className="iz-caseform__row">
                        <button type="submit" className="iz-btn iz-btn--primary" style={{ padding: "3px 12px", fontSize: 12.5 }}>
                          Submit group {group.id}
                        </button>
                        {reportFeedback[`${report.reportId}:${group.id}`] !== undefined && (
                          <p
                            className={`iz-caseform__feedback ${
                              reportFeedback[`${report.reportId}:${group.id}`]!.kind === "ok"
                                ? "iz-caseform__feedback--ok"
                                : "iz-caseform__feedback--bad"
                            }`}
                            role="status"
                            style={{ margin: 0 }}
                          >
                            {reportFeedback[`${report.reportId}:${group.id}`]!.text}
                          </p>
                        )}
                      </div>
                    </form>
                  ))
                )}
              </div>
            );
          })
        )}
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
        <p className="iz-casefile__label">Hints used</p>
        {Object.keys(state.hintsUsed).length === 0 ? (
          <p style={{ margin: 0, color: "var(--iz-faint)", fontSize: 12.5 }}>None. Hints cost score.</p>
        ) : (
          <ul className="iz-casefile__list">
            {Object.entries(state.hintsUsed).map(([gateId, tier]) => (
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
          {Object.values(state.evidence).length !== activeEvidence.length &&
            ` · ${Object.values(state.evidence).length - activeEvidence.length} archived`}
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

function OpenGateCard({ gate, answer, onAnswer, onSubmit, feedback, hints, usedTier, onRequestHint }: {
  gate: { gateId: string; title: string };
  answer: string;
  onAnswer: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  feedback: Feedback | undefined;
  hints: HintView[];
  usedTier: number;
  onRequestHint: (tier: 1 | 2 | 3) => void;
}): ReactNode {
  const nextTier = (usedTier + 1) as 1 | 2 | 3;
  const canRequest = usedTier < 3;
  return (
    <div style={{ borderTop: "1px solid var(--iz-line)", paddingTop: 8, marginTop: 8 }}>
      <p style={{ margin: "0 0 4px", fontSize: 12.5, fontWeight: 600 }}>{gate.title}</p>
      <p style={{ margin: "0 0 6px", fontFamily: "var(--iz-font-mono)", fontSize: 11, color: "var(--iz-faint)" }}>{gate.gateId}</p>
      <form className="iz-caseform" onSubmit={onSubmit} aria-label={`Answer gate ${gate.title}`}>
        <div className="iz-caseform__row">
          <input
            className="iz-input"
            value={answer}
            onChange={(e) => onAnswer(e.target.value)}
            placeholder="your answer"
            aria-label={`Answer for ${gate.title}`}
            autoComplete="off"
          />
          <button type="submit" className="iz-btn" style={{ padding: "3px 12px", fontSize: 12.5 }}>
            Answer
          </button>
        </div>
        {feedback !== undefined && (
          <p className={`iz-caseform__feedback ${feedback.kind === "ok" ? "iz-caseform__feedback--ok" : "iz-caseform__feedback--bad"}`} role="status">
            {feedback.text}
          </p>
        )}
      </form>
      {canRequest && (
        <button
          type="button"
          className="iz-btn iz-btn--quiet"
          style={{ padding: "2px 8px", fontSize: 11.5 }}
          onClick={() => onRequestHint(nextTier)}
        >
          Request hint (tier {nextTier})
        </button>
      )}
      {hints.map((hint) => (
        <p key={hint.tier} className="iz-caseform__hint">
          {hint.text}
          <span className="iz-caseform__hintcost">
            tier {hint.tier} · −{hint.cost} points
          </span>
        </p>
      ))}
    </div>
  );
}
