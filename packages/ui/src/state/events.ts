import type { Attempt, GameEvent } from "@iz/schema";
import { normalizeWire, type WireRuntimeState } from "./wire.js";

/**
 * Client-side event merge: applies GameEvents onto the wire state, mirroring
 * packages/runtime fold.ts — but WITHOUT the bundle (the server never sends
 * it). Consequences, by design:
 *
 * - GateSolved: unlocks (bundle gate.unlock ids) are NOT derivable, so the
 *   client does not touch `unlocked` here. The authoritative `unlocked` set
 *   comes from GET /api/state (refreshState). Everything else (solvedGates,
 *   score) is derivable and idempotent: a duplicate GateSolved never
 *   double-scores (fold has the same guard).
 * - EvidenceCollected: provenance (host/path/service) comes from the artifact,
 *   which the client cannot see. Callers may pass `context.provenance` hints
 *   keyed by evidence id (the browser fills this from the view it collected
 *   on); unknown provenance is recorded as empty strings and corrected on the
 *   next refreshState.
 * - WorldEventFired: effect unlocks are bundle-derived — only firedEvents is
 *   updated here.
 * - HintRequested: fold applies score -= cost for every event; since the same
 *   event can reach the client twice (REST response + WS broadcast), this
 *   merge scores a tier only when it RAISES hintsUsed for the gate. Same net
 *   result as fold for each distinct event, and idempotent under duplicates.
 *
 * Every other rule matches fold.ts exactly (evidence/claims/links keep-first
 * by id, attempts capped to the newest 50, overlay marks existence only).
 */

export const MAX_TRACKED_ATTEMPTS = 50;

export interface MergeContext {
  /** Optional provenance hints for new evidence, keyed by evidence id. */
  provenance?: Record<string, { host: string; path: string; service: string }>;
}

function recordAttempt(attempts: Record<string, Attempt[]>, key: string, at: string, by: string): Record<string, Attempt[]> {
  const arr = [...(attempts[key] ?? []), { at, by }];
  return { ...attempts, [key]: arr.length > MAX_TRACKED_ATTEMPTS ? arr.slice(arr.length - MAX_TRACKED_ATTEMPTS) : arr };
}

function overlayKey(host: string, path: string): string {
  return `${host}::${path}`;
}

export function applyEventsToWire(
  state: WireRuntimeState,
  events: readonly GameEvent[],
  context: MergeContext = {}
): WireRuntimeState {
  let s = state;
  for (const event of events) {
    s = applyOne(s, event, context);
  }
  // Keep the set-shaped arrays sorted + unique so the result is always a valid
  // wire state (mirrors the server's serialization).
  return normalizeWire(s);
}

function applyOne(state: WireRuntimeState, event: GameEvent, context: MergeContext): WireRuntimeState {
  switch (event.type) {
    case "SessionStarted":
      // Identity fields: fill only if absent (state may already carry them).
      return {
        ...state,
        teamId: state.teamId || event.teamId,
        worldId: state.worldId || event.worldId,
        bundleHash: state.bundleHash || event.bundleHash,
        startedAt: state.startedAt || event.startedAt,
      };

    case "GateSolved": {
      if (state.solvedGates[event.gateId] !== undefined) return state; // idempotent: never double-score
      return {
        ...state,
        solvedGates: { ...state.solvedGates, [event.gateId]: { at: event.at, by: event.by } },
        score: state.score + event.score,
      };
    }

    case "ArtifactViewed":
      return state; // analytics only

    case "EvidenceCollected": {
      if (state.evidence[event.evidenceId] !== undefined) return state; // keep first
      const hint = context.provenance?.[event.evidenceId];
      return {
        ...state,
        evidence: {
          ...state.evidence,
          [event.evidenceId]: {
            id: event.evidenceId,
            artifactId: event.artifactId,
            ...(event.fragment !== undefined ? { fragment: event.fragment } : {}),
            collectedBy: event.by,
            collectedAt: event.at,
            provenance: hint ?? { host: "", path: "", service: "archive" },
            archived: false,
          },
        },
      };
    }

    case "EvidenceArchived": {
      const item = state.evidence[event.evidenceId];
      if (item === undefined || item.archived) return state;
      return { ...state, evidence: { ...state.evidence, [event.evidenceId]: { ...item, archived: true } } };
    }

    case "ClaimCreated": {
      if (state.claims[event.claimId] !== undefined) return state; // keep first
      return {
        ...state,
        claims: {
          ...state.claims,
          [event.claimId]: {
            id: event.claimId,
            text: event.text,
            ...(event.slots !== undefined ? { slots: event.slots } : {}),
            createdBy: event.by,
            createdAt: event.at,
            private: event.private,
          },
        },
      };
    }

    case "ClaimEdited": {
      const claim = state.claims[event.claimId];
      if (claim === undefined) return state;
      return { ...state, claims: { ...state.claims, [event.claimId]: { ...claim, text: event.text } } };
    }

    case "LinkCreated": {
      if (state.links[event.linkId] !== undefined) return state; // keep first
      return {
        ...state,
        links: {
          ...state.links,
          [event.linkId]: {
            id: event.linkId,
            from: event.from,
            to: event.to,
            relation: event.relation,
            confidence: event.confidence,
            createdBy: event.by,
            createdAt: event.at,
          },
        },
      };
    }

    case "LinkRemoved": {
      if (state.links[event.linkId] === undefined) return state;
      const links = { ...state.links };
      delete links[event.linkId];
      return { ...state, links };
    }

    case "HintRequested": {
      const previous = state.hintsUsed[event.gateId] ?? 0;
      const next = Math.max(previous, event.tier);
      if (next === previous) return state; // duplicate delivery: no double cost
      return {
        ...state,
        hintsUsed: { ...state.hintsUsed, [event.gateId]: next },
        score: state.score - event.cost,
      };
    }

    case "AnswerRejected":
      return { ...state, attempts: recordAttempt(state.attempts, event.gateId, event.at, event.by) };

    case "ReportRejected":
      return { ...state, attempts: recordAttempt(state.attempts, event.reportId, event.at, event.by) };

    case "ReportGroupAccepted": {
      const groups = state.reportGroupsAccepted[event.reportId] ?? [];
      if (groups.includes(event.groupId)) return state;
      return {
        ...state,
        reportGroupsAccepted: { ...state.reportGroupsAccepted, [event.reportId]: [...groups, event.groupId] },
      };
    }

    case "TerminalRead": {
      const paths = state.readPaths[event.host] ?? [];
      if (paths.includes(event.path)) return state;
      return {
        ...state,
        readPaths: { ...state.readPaths, [event.host]: [...paths, event.path].sort() },
      };
    }

    case "TerminalOverlayWrite": {
      const key = overlayKey(event.host, event.path);
      if (state.overlayFs[key] === "") return state; // existence marker only
      return { ...state, overlayFs: { ...state.overlayFs, [key]: "" } };
    }

    case "WorldEventFired": {
      if (state.firedEvents.includes(event.eventId)) return state;
      // Effect unlocks are bundle-derived; the client marks the event fired and
      // picks up the actual unlocks on the next authoritative GET /api/state.
      return { ...state, firedEvents: [...state.firedEvents, event.eventId].sort() };
    }
  }
}
