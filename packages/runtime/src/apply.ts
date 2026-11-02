import type { Action, Actor, Clock, GameEvent, Rejection, RuntimeState, SolvedGate, WorldBundle } from "@iz/schema";
import { normalizeAnswer, SlotNormalizers } from "@iz/schema";
import { hashAnswer } from "./hash.js";
import { derivedEventSeq, deterministicId, fragmentKey, type IdPrefix } from "./ids.js";
import { evaluateCondition } from "./conditions.js";
import { artifactVisible, findArtifactAt, hostReachable, type IsUnlocked } from "./visibility.js";
import { effectUnlocks, eventIsDue } from "./world-events.js";
import { implicitGateSatisfied } from "./implicit-gates.js";
import { rateLimitFor } from "./rate-limit.js";
import { settleEvents } from './settle.js';

export interface ApplyResult {
  events: GameEvent[];
  result?: unknown;
  rejection?: Rejection;
}

/**
 * The reducer (§9). apply NEVER mutates state and never touches the wall
 * clock: all state changes flow through the returned events, which the caller
 * appends to the team's log and replays with fold().
 *
 * apply(bundle, state, action, actor, clock, eventSeq?) — eventSeq is an
 * OPTIONAL extension to the frozen signature: the number of events already in
 * the team's log, used to seed deterministic ids. The server passes the
 * store's next sequence; when omitted, a state-derived sequence is used (see
 * ids.ts). This extension is backwards compatible with the frozen signature.
 *
 * The action is assumed to be schema-valid (the server validates with the
 * Action schema before calling); malformed input degrades to an invalid_input
 * rejection rather than a throw.
 *
 * Order of work per apply:
 *   1. due world events fire (§13) and their unlocks are overlaid so the rest
 *      of THIS apply already sees them;
 *   2. implicit gates (terminal / evidenceSet / report) are checked and emit
 *      GateSolved (checks-then-emits; after a fold these are already
 *      materialized by fold's final pass, so this mostly guards states that
 *      were not fold-produced — e.g. initialState fed straight in);
 *   3. the action itself runs.
 */
export function apply(
  bundle: WorldBundle, state: RuntimeState, action: Action, actor: Actor, clock: Clock, eventSeq?: number,
): ApplyResult {
  if (!Number.isFinite(Date.parse(clock.now()))) {
    return { events: [], rejection: { code: 'invalid_input', message: 'Invalid clock.' } };
  }
  const result = applyAction(bundle, state, action, actor, clock, eventSeq);
  return { ...result, events: settleEvents(bundle, state, result.events, actor, clock) };
}

function applyAction(
  bundle: WorldBundle,
  state: RuntimeState,
  action: Action,
  actor: Actor,
  clock: Clock,
  eventSeq?: number
): ApplyResult {
  const now = clock.now();
  const events: GameEvent[] = [];
  const baseSeq = eventSeq !== undefined ? eventSeq : derivedEventSeq(state);
  let created = 0;
  const nextBase = () => {
    created += 1;
    return { at: now, by: actor.userId, actorKind: actor.kind };
  };
  const nextId = (prefix: IdPrefix, kind: string, salt: string): string =>
    deterministicId(prefix, state.teamId, baseSeq + created, kind, salt);

  // --- 1. due world events (§13) ---
  const overlay = new Set<string>();
  for (const def of bundle.events) {
    if (state.firedEvents.has(def.id)) continue;
    if (!eventIsDue(def, state, bundle, now)) continue;
    events.push({ type: "WorldEventFired", eventId: def.id, ...nextBase() });
    for (const effect of def.effects) effectUnlocks(effect, overlay);
  }

  const isUnlocked: IsUnlocked = (id) => state.unlocked.has(id) || overlay.has(id);
  const pending = new Map<string, SolvedGate>();
  const effState = (): RuntimeState => ({
    ...state,
    solvedGates: { ...state.solvedGates, ...Object.fromEntries(pending) },
  });

  // --- 2. implicit gates (checked-then-emitted, to fixpoint) ---
  let changed = true;
  let guard = 0;
  while (changed && guard <= bundle.gates.length + 1) {
    changed = false;
    guard += 1;
    for (const gate of bundle.gates) {
      if (state.solvedGates[gate.id] !== undefined || pending.has(gate.id)) continue;
      if (!implicitGateSatisfied(bundle, gate, effState(), isUnlocked, now)) continue;
      pending.set(gate.id, { at: now, by: actor.userId });
      events.push({ type: "GateSolved", gateId: gate.id, score: gate.score, ...nextBase() });
      for (const id of gate.unlocks) overlay.add(id);
      changed = true;
    }
  }
  const solvedNow = (gateId: string): boolean => state.solvedGates[gateId] !== undefined || pending.has(gateId);

  // --- 3. the action ---
  switch (action.type) {
    case "open": {
      const parsed = parseUrl(action.url);
      if (!safePath(parsed.path)) return { events, rejection: { code: 'invalid_input', message: 'Invalid in-game path.' } };
      const hostDef = bundle.world.hosts.find((h) => h.host === parsed.host);
      // Unknown and unreachable hosts are intentionally indistinguishable (§10.1).
      if (hostDef === undefined || !hostReachable(bundle, hostDef, effState(), isUnlocked, now)) {
        return { events, rejection: { code: "not_found", message: "Host not found." } };
      }
      const artifact = findArtifactAt(bundle, parsed.host, parsed.path);
      if (artifact === undefined) {
        // Reachable host, unknown page: the server renders its own not-found view.
        return { events };
      }
      if (!artifactVisible(bundle, artifact, effState(), isUnlocked, now)) {
        return { events, rejection: { code: "locked", message: "This page is not available." } };
      }
      events.push({ type: "ArtifactViewed", artifactId: artifact.id, ...nextBase() });
      return { events };
    }

    case "search": {
      // Search execution/visibility filtering is a server read performed with
      // visibleArtifacts(); the runtime stays authoritative about the query.
      const result: { query: string; host?: string } = { query: action.query };
      if (action.host !== undefined) result.host = action.host;
      return { events, result };
    }

    case "collect": {
      const artifact = bundle.artifacts.find((a) => a.id === action.artifactId);
      if (artifact === undefined) {
        return { events, rejection: { code: "not_found", message: "No such artifact." } };
      }
      if (!artifactVisible(bundle, artifact, effState(), isUnlocked, now)) {
        return { events, rejection: { code: "locked", message: "This artifact is not available." } };
      }
      const key = fragmentKey(action.fragment);
      for (const existing of Object.values(state.evidence)) {
        if (existing.artifactId === action.artifactId && fragmentKey(existing.fragment) === key) {
          return { events, result: { evidenceId: existing.id } }; // idempotent (§7), no new event
        }
      }
      const evidenceId = nextId("ev", "evidence", `${action.artifactId}|${key}`);
      events.push({
        type: "EvidenceCollected",
        evidenceId,
        artifactId: action.artifactId,
        ...(action.fragment !== undefined ? { fragment: action.fragment } : {}),
        ...nextBase(),
      });
      return { events, result: { evidenceId } };
    }

    case "archiveEvidence": {
      if (state.evidence[action.evidenceId] === undefined) {
        return { events, rejection: { code: "not_found", message: "No such evidence." } };
      }
      events.push({ type: "EvidenceArchived", evidenceId: action.evidenceId, ...nextBase() });
      return { events, result: { evidenceId: action.evidenceId } };
    }

    case "claim": {
      const isPrivate = action.private ?? false;
      const claimId = nextId("cl", "claim", `${action.text}|${JSON.stringify(action.slots ?? {})}|${isPrivate}`);
      events.push({
        type: "ClaimCreated",
        claimId,
        text: action.text,
        ...(action.slots !== undefined ? { slots: action.slots } : {}),
        private: isPrivate,
        ...nextBase(),
      });
      return { events, result: { claimId } };
    }

    case "editClaim": {
      if (state.claims[action.claimId] === undefined) {
        return { events, rejection: { code: "not_found", message: "No such claim." } };
      }
      events.push({ type: "ClaimEdited", claimId: action.claimId, text: action.text, ...nextBase() });
      return { events, result: { claimId: action.claimId } };
    }

    case "link": {
      const exists = (id: string): boolean => state.evidence[id] !== undefined || state.claims[id] !== undefined;
      if (!exists(action.from) || !exists(action.to)) {
        return { events, rejection: { code: "not_found", message: "Link endpoints must be existing evidence or claims." } };
      }
      const linkId = nextId("ln", "link", `${action.from}>${action.to}|${action.relation}|${String(action.confidence)}`);
      events.push({
        type: "LinkCreated",
        linkId,
        from: action.from,
        to: action.to,
        relation: action.relation,
        confidence: action.confidence,
        ...nextBase(),
      });
      return { events, result: { linkId } };
    }

    case "unlink": {
      if (state.links[action.linkId] === undefined) {
        return { events, rejection: { code: "not_found", message: "No such link." } };
      }
      events.push({ type: "LinkRemoved", linkId: action.linkId, ...nextBase() });
      return { events, result: { linkId: action.linkId } };
    }

    case "submitAnswer": {
      const gate = bundle.gates.find((g) => g.id === action.gateId);
      if (gate === undefined) {
        return { events, rejection: { code: "not_found", message: "No such gate." } };
      }
      if (solvedNow(gate.id)) {
        return { events, rejection: { code: "already_solved", message: "This gate is already solved." } };
      }
      if (gate.requires !== undefined && !evaluateCondition(gate.requires, effState(), bundle, now)) {
        return { events, rejection: { code: "locked", message: "This gate is not available yet." } };
      }
      // Rate limit BEFORE grading, so a throttled submission reveals nothing.
      const verdict = rateLimitFor(state, gate.id, now);
      if (verdict.limited) {
        events.push({
          type: "AnswerRejected",
          gateId: gate.id,
          retryAfterSeconds: verdict.retryAfterSeconds,
          ...nextBase(),
        });
        return {
          events,
          rejection: {
            code: "rate_limited",
            message: "Too many attempts. Try again later.",
            retryAfterSeconds: verdict.retryAfterSeconds,
          },
        };
      }
      if (gate.check.kind !== "answer") {
        // Non-answer gates solve implicitly; a free-text attempt is a no-op and
        // deliberately not recorded as an attempt event.
        return { events, rejection: { code: "invalid_input", message: "This gate does not take a free-text answer." } };
      }
      const normalized = normalizeAnswer(action.answer, gate.check.normalize);
      if (gate.check.answerHashes.includes(hashAnswer(bundle.bundleSalt, gate.id, normalized))) {
        events.push({ type: "GateSolved", gateId: gate.id, score: gate.score, ...nextBase() });
        return { events, result: { accepted: true, solved: true } };
      }
      events.push({ type: "AnswerRejected", gateId: gate.id, ...nextBase() });
      return { events, rejection: { code: "invalid_input", message: "Incorrect answer." } };
    }

    case "submitReport": {
      const report = bundle.reports.find((r) => r.id === action.reportId);
      if (report === undefined) {
        return { events, rejection: { code: "not_found", message: "No such report." } };
      }
      const reportGate = bundle.gates.find((gate) => gate.check.kind === 'report' && gate.check.report === report.id);
      if (reportGate === undefined || (reportGate.requires !== undefined && !evaluateCondition(reportGate.requires, effState(), bundle, now))) {
        return { events, rejection: { code: 'locked', message: 'This report is not available yet.' } };
      }
      const group = report.groups.find((g) => g.id === action.groupId);
      if (group === undefined) {
        return { events, rejection: { code: "not_found", message: "No such report group." } };
      }
      const accepted = state.reportGroupsAccepted[report.id] ?? [];
      if (accepted.includes(group.id)) {
        return { events, rejection: { code: "already_solved", message: "This group was already accepted." } };
      }
      const verdict = rateLimitFor(state, report.id, now);
      if (verdict.limited) {
        events.push({
          type: "ReportRejected",
          reportId: report.id,
          groupId: group.id,
          retryAfterSeconds: verdict.retryAfterSeconds,
          ...nextBase(),
        });
        return {
          events,
          rejection: {
            code: "rate_limited",
            message: "Too many attempts. Try again later.",
            retryAfterSeconds: verdict.retryAfterSeconds,
          },
        };
      }
      // Grade the whole group; the response only ever says which GROUPS were
      // accepted, never which individual slots were wrong (§8).
      const allCorrect = group.slots.every((slot) => {
        const value = action.slots[slot.id] ?? "";
        const normalized = normalizeAnswer(value, SlotNormalizers[slot.type]);
        return slot.answerHashes.includes(hashAnswer(bundle.bundleSalt, slot.id, normalized));
      });
      if (allCorrect) {
        events.push({ type: "ReportGroupAccepted", reportId: report.id, groupId: group.id, ...nextBase() });
        return { events, result: { acceptedGroups: [group.id] } };
      }
      events.push({ type: "ReportRejected", reportId: report.id, groupId: group.id, ...nextBase() });
      return { events, rejection: { code: "invalid_input", message: "One or more report fields are incorrect." } };
    }

    case "requestHint": {
      const gate = bundle.gates.find((g) => g.id === action.gateId);
      if (gate === undefined) {
        return { events, rejection: { code: "not_found", message: "No such gate." } };
      }
      const solved = solvedNow(gate.id);
      if (!solved && gate.requires !== undefined && !evaluateCondition(gate.requires, effState(), bundle, now)) {
        return { events, rejection: { code: "locked", message: "This gate is not available yet." } };
      }
      const used = state.hintsUsed[gate.id] ?? 0;
      if (action.tier <= used) {
        return { events, rejection: { code: "invalid_input", message: "This hint tier was already requested." } };
      }
      if (action.tier > used + 1) {
        return { events, rejection: { code: "invalid_input", message: "Request the previous hint tier first." } };
      }
      const hint = bundle.hints.find((h) => h.gate === gate.id && h.tier === action.tier);
      if (hint === undefined) {
        return { events, rejection: { code: "invalid_input", message: "No hint is defined for this tier." } };
      }
      events.push({ type: "HintRequested", gateId: gate.id, tier: action.tier, cost: hint.cost, ...nextBase() });
      return { events, result: { gateId: gate.id, tier: action.tier, text: hint.text, cost: hint.cost } };
    }

    case "terminal": {
      // §19.3 terminal split: the runtime only GATES the command; it never
      // interprets it. packages/terminal's exec() runs against the virtual fs
      // + overlay and RETURNS the resulting GameEvents (TerminalRead,
      // TerminalOverlayWrite); the server appends those events to the store
      // directly — they are already valid events that fold() replays (read
      // paths, overlay markers). That is why a successful terminal action
      // produces no events here.
      if (!safePath(action.cwd)) return { events, rejection: { code: 'invalid_input', message: 'Invalid terminal directory.' } };
      const hostDef = bundle.world.hosts.find((h) => h.host === action.host);
      if (hostDef === undefined || hostDef.service !== "terminal" || !hostReachable(bundle, hostDef, effState(), isUnlocked, now)) {
        return { events, rejection: { code: "locked", message: "No terminal is available on this host." } };
      }
      if (action.line.trim().length === 0) {
        return { events, rejection: { code: "invalid_input", message: "Empty command." } };
      }
      return { events, result: { accepted: true } };
    }

    default:
      return { events, rejection: { code: "invalid_input", message: "Unsupported action." } };
  }
}

/**
 * In-game URLs are "host/path" (§10.1). The host part is case-insensitive
 * (hostnames); the path is compared verbatim against the artifact's path, and
 * an empty path means "/".
 */
function safePath(path: string): boolean {
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return false; }
  return !decoded.includes('\\') && !decoded.includes('?') && !decoded.includes('#') && !decoded.includes('//') && !decoded.includes('\0') && !decoded.split('/').includes('..');
}

function parseUrl(url: string): { host: string; path: string } {
  const trimmed = url.trim();
  const slashIndex = trimmed.indexOf("/");
  const host = (slashIndex === -1 ? trimmed : trimmed.slice(0, slashIndex)).toLowerCase();
  const rawPath = slashIndex === -1 ? "" : trimmed.slice(slashIndex);
  return { host, path: rawPath === "" ? "/" : rawPath };
}
