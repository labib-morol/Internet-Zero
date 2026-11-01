import { z } from "zod";
import { Fragment, Id, IsoTime, LinkRelation } from "./primitives.js";
import { Confidence } from "./state.js";

/**
 * Game events (§9, §12). The event log is the single source of truth:
 * fold(events) reproduces state. Ids inside events are deterministic
 * (seeded by teamId + sequence) and assigned by the runtime.
 */
const base = {
  at: IsoTime,
  by: z.string().min(1),
  actorKind: z.enum(["human", "agent"]).default("human"),
};

export const GameEvent = z.discriminatedUnion("type", [
  /** Always the first event of a team stream; fold() derives identity fields from it. */
  z.strictObject({
    type: z.literal("SessionStarted"),
    teamId: z.string(),
    worldId: z.string(),
    bundleHash: z.string(),
    startedAt: IsoTime,
    ...base,
  }),
  z.strictObject({ type: z.literal("GateSolved"), gateId: Id, score: z.number().int(), ...base }),
  z.strictObject({ type: z.literal("ArtifactViewed"), artifactId: Id, ...base }),
  z.strictObject({
    type: z.literal("EvidenceCollected"),
    evidenceId: z.string(),
    artifactId: Id,
    fragment: Fragment.optional(),
    ...base,
  }),
  z.strictObject({ type: z.literal("EvidenceArchived"), evidenceId: z.string(), ...base }),
  z.strictObject({
    type: z.literal("ClaimCreated"),
    claimId: z.string(),
    text: z.string(),
    slots: z.record(z.string(), z.string()).optional(),
    private: z.boolean(),
    ...base,
  }),
  z.strictObject({ type: z.literal("ClaimEdited"), claimId: z.string(), text: z.string(), ...base }),
  z.strictObject({
    type: z.literal("LinkCreated"),
    linkId: z.string(),
    from: z.string(),
    to: z.string(),
    relation: LinkRelation,
    confidence: Confidence,
    ...base,
  }),
  z.strictObject({ type: z.literal("LinkRemoved"), linkId: z.string(), ...base }),
  z.strictObject({ type: z.literal("HintRequested"), gateId: Id, tier: z.union([z.literal(1), z.literal(2), z.literal(3)]), cost: z.number().int(), ...base }),
  z.strictObject({ type: z.literal("AnswerRejected"), gateId: Id, retryAfterSeconds: z.number().int().optional(), ...base }),
  z.strictObject({ type: z.literal("ReportRejected"), reportId: Id, groupId: z.string(), retryAfterSeconds: z.number().int().optional(), ...base }),
  z.strictObject({ type: z.literal("ReportGroupAccepted"), reportId: Id, groupId: z.string(), ...base }),
  z.strictObject({ type: z.literal("TerminalRead"), host: z.string(), path: z.string(), ...base }),
  z.strictObject({ type: z.literal("TerminalOverlayWrite"), host: z.string(), path: z.string(), ...base }),
  z.strictObject({ type: z.literal("WorldEventFired"), eventId: Id, ...base }),
]);
export type GameEvent = z.infer<typeof GameEvent>;
export type GameEventType = GameEvent["type"];

/** Stored envelope: the event store assigns seq per team stream (§15). */
export const EventEnvelope = z.strictObject({
  seq: z.number().int().min(1),
  event: GameEvent,
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;
