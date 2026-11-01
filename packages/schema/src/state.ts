import { z } from "zod";
import { Fragment, Id, IsoTime, LinkRelation } from "./primitives.js";

export const EvidenceItem = z.strictObject({
  id: z.string().min(1),
  artifactId: Id,
  fragment: Fragment.optional(),
  collectedBy: z.string().min(1),
  collectedAt: IsoTime,
  provenance: z.strictObject({ host: z.string(), path: z.string(), service: z.string() }),
  /** Archived evidence is hidden from the board but kept in the log. */
  archived: z.boolean().default(false),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export const Claim = z.strictObject({
  id: z.string().min(1),
  text: z.string().min(1),
  slots: z.record(z.string(), z.string()).optional(),
  createdBy: z.string().min(1),
  createdAt: IsoTime,
  private: z.boolean().default(false),
});
export type Claim = z.infer<typeof Claim>;

export const Confidence = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Confidence = z.infer<typeof Confidence>;

export const Link = z.strictObject({
  id: z.string().min(1),
  /** Evidence or claim id. */
  from: z.string().min(1),
  /** Evidence or claim id. */
  to: z.string().min(1),
  relation: LinkRelation,
  confidence: Confidence,
  createdBy: z.string().min(1),
  createdAt: IsoTime,
});
export type Link = z.infer<typeof Link>;

export const SolvedGate = z.strictObject({ at: IsoTime, by: z.string() });
export type SolvedGate = z.infer<typeof SolvedGate>;

export const Attempt = z.strictObject({ at: IsoTime, by: z.string() });
export type Attempt = z.infer<typeof Attempt>;

/** Full team state (§9). Server-side; projected into view models for clients. */
export const RuntimeState = z.strictObject({
  teamId: z.string(),
  worldId: z.string(),
  bundleHash: z.string(),
  startedAt: IsoTime,
  solvedGates: z.record(z.string(), SolvedGate),
  unlocked: z.set(z.string()),
  evidence: z.record(z.string(), EvidenceItem),
  claims: z.record(z.string(), Claim),
  links: z.record(z.string(), Link),
  hintsUsed: z.record(z.string(), z.number().int().min(0)),
  reportGroupsAccepted: z.record(z.string(), z.array(z.string())),
  firedEvents: z.set(z.string()),
  /** Player-created terminal files, host+path -> content. */
  overlayFs: z.record(z.string(), z.string()),
  /** Terminal files the team has read, host -> set of paths (terminal gates). */
  readPaths: z.record(z.string(), z.set(z.string())),
  attempts: z.record(z.string(), z.array(Attempt)),
  score: z.number().int(),
});
export type RuntimeState = z.infer<typeof RuntimeState>;

export const Actor = z.strictObject({
  userId: z.string().min(1),
  kind: z.enum(["human", "agent"]),
});
export type Actor = z.infer<typeof Actor>;

/** Injected clock; tests use a fixed clock (§9). */
export interface Clock {
  now(): string;
}
