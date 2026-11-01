import type { EvidenceItem, GameEvent, RuntimeState, WorldBundle } from "@iz/schema";
import { initialState } from "./state.js";
import { finalizeImplicitGates } from "./implicit-gates.js";
import { effectUnlocks } from "./world-events.js";
import { recordAttempt } from "./rate-limit.js";
import { overlayKey } from "./ids.js";

/**
 * Reconstruct state purely from the event log (§9). The log MUST start with a
 * SessionStarted event; fold derives the state's identity fields (teamId,
 * worldId, bundleHash, startedAt) from it and validates them against the
 * bundle (a log from another world or bundle build is a hard error).
 *
 * fold replays GameEvents — including events the server appended outside of
 * apply, such as TerminalRead / TerminalOverlayWrite produced by
 * packages/terminal's exec() (§19.3) — and then runs the implicit-gate final
 * pass over the final state using the last event's at/by, so gates satisfied
 * by the log's tail are solved in the returned state even without a further
 * apply.
 */
export function fold(bundle: WorldBundle, events: GameEvent[]): RuntimeState {
  const first = events[0];
  if (first === undefined || first.type !== "SessionStarted") {
    throw new Error("fold: event log must start with a SessionStarted event");
  }
  if (first.worldId !== bundle.world.id || first.bundleHash !== bundle.bundleHash) {
    throw new Error("fold: event log was produced for a different world or bundle build");
  }
  const state = initialState(bundle, first.teamId, first.startedAt);
  replayEvents(bundle, state, events);
  const last = events[events.length - 1];
  if (last !== undefined) finalizeImplicitGates(bundle, state, last.at, last.by);
  return state;
}

/**
 * Low-level replay: applies events onto an EXISTING state without the
 * implicit-gate final pass. Exported for chunked folding and for tests:
 * fold(all) === finalize(replay(replay(init, prefix), suffix), last.at/by).
 * Mutates and returns `state`.
 */
export function replayEvents(bundle: WorldBundle, state: RuntimeState, events: readonly GameEvent[]): RuntimeState {
  for (const event of events) {
    switch (event.type) {
      case "SessionStarted":
        // Identity was already consumed by fold(); replaying a SessionStarted
        // mid-log or onto a chunk base is a no-op.
        break;

      case "GateSolved": {
        if (state.solvedGates[event.gateId] !== undefined) break; // idempotent: never double-score
        state.solvedGates[event.gateId] = { at: event.at, by: event.by };
        const gate = bundle.gates.find((g) => g.id === event.gateId);
        if (gate !== undefined) {
          for (const id of gate.unlocks) state.unlocked.add(id);
        }
        state.score += event.score;
        break;
      }

      case "ArtifactViewed":
        // Analytics only; no state change.
        break;

      case "EvidenceCollected": {
        if (state.evidence[event.evidenceId] !== undefined) break; // keep first
        const artifact = bundle.artifacts.find((a) => a.id === event.artifactId);
        const hostDef =
          artifact !== undefined ? bundle.world.hosts.find((h) => h.host === artifact.host) : undefined;
        const item: EvidenceItem = {
          id: event.evidenceId,
          artifactId: event.artifactId,
          ...(event.fragment !== undefined ? { fragment: event.fragment } : {}),
          collectedBy: event.by,
          collectedAt: event.at,
          provenance: {
            host: artifact?.host ?? "",
            path: artifact?.path ?? "",
            service: hostDef?.service ?? "archive",
          },
          archived: false,
        };
        state.evidence[event.evidenceId] = item;
        break;
      }

      case "EvidenceArchived": {
        const item = state.evidence[event.evidenceId];
        if (item !== undefined) item.archived = true;
        break;
      }

      case "ClaimCreated": {
        if (state.claims[event.claimId] !== undefined) break; // keep first
        state.claims[event.claimId] = {
          id: event.claimId,
          text: event.text,
          ...(event.slots !== undefined ? { slots: event.slots } : {}),
          createdBy: event.by,
          createdAt: event.at,
          private: event.private,
        };
        break;
      }

      case "ClaimEdited": {
        const claim = state.claims[event.claimId];
        if (claim !== undefined) claim.text = event.text;
        break;
      }

      case "LinkCreated": {
        if (state.links[event.linkId] !== undefined) break; // keep first
        state.links[event.linkId] = {
          id: event.linkId,
          from: event.from,
          to: event.to,
          relation: event.relation,
          confidence: event.confidence,
          createdBy: event.by,
          createdAt: event.at,
        };
        break;
      }

      case "LinkRemoved":
        delete state.links[event.linkId];
        break;

      case "HintRequested":
        state.hintsUsed[event.gateId] = Math.max(state.hintsUsed[event.gateId] ?? 0, event.tier);
        state.score -= event.cost;
        break;

      case "AnswerRejected":
        recordAttempt(state.attempts, event.gateId, event.at, event.by);
        break;

      case "ReportRejected":
        recordAttempt(state.attempts, event.reportId, event.at, event.by);
        break;

      case "ReportGroupAccepted": {
        const groups = state.reportGroupsAccepted[event.reportId] ?? [];
        if (!groups.includes(event.groupId)) groups.push(event.groupId);
        state.reportGroupsAccepted[event.reportId] = groups;
        break;
      }

      case "TerminalRead": {
        const paths = state.readPaths[event.host] ?? new Set<string>();
        paths.add(event.path);
        state.readPaths[event.host] = paths;
        break;
      }

      case "TerminalOverlayWrite":
        // The frozen GameEvent carries no file content, so fold can only mark
        // file EXISTENCE. Authoritative overlay content lives with the server
        // (packages/terminal exec returns the overlayPatch; the server keeps
        // it alongside the folded state).
        state.overlayFs[overlayKey(event.host, event.path)] = "";
        break;

      case "WorldEventFired": {
        state.firedEvents.add(event.eventId);
        const def = bundle.events.find((d) => d.id === event.eventId);
        if (def !== undefined) {
          for (const effect of def.effects) effectUnlocks(effect, state.unlocked);
        }
        break;
      }
    }
  }
  return state;
}
