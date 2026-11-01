import { z } from "zod";
import { Fragment, Id, LinkRelation } from "./primitives.js";
import { Confidence } from "./state.js";

/** Player/agent actions (§9). Everything goes through runtime apply(). */
export const Action = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("open"), url: z.string().min(1) }),
  z.strictObject({ type: z.literal("search"), query: z.string().min(1), host: z.string().optional() }),
  z.strictObject({
    type: z.literal("collect"),
    artifactId: Id,
    fragment: Fragment.optional(),
  }),
  z.strictObject({ type: z.literal("archiveEvidence"), evidenceId: z.string().min(1) }),
  z.strictObject({
    type: z.literal("claim"),
    text: z.string().min(1).max(2000),
    slots: z.record(z.string(), z.string()).optional(),
    private: z.boolean().default(false),
  }),
  z.strictObject({ type: z.literal("editClaim"), claimId: z.string().min(1), text: z.string().min(1).max(2000) }),
  z.strictObject({
    type: z.literal("link"),
    from: z.string().min(1),
    to: z.string().min(1),
    relation: LinkRelation,
    confidence: Confidence,
  }),
  z.strictObject({ type: z.literal("unlink"), linkId: z.string().min(1) }),
  z.strictObject({ type: z.literal("submitAnswer"), gateId: Id, answer: z.string().min(1).max(256) }),
  z.strictObject({
    type: z.literal("submitReport"),
    reportId: Id,
    groupId: z.string().min(1),
    slots: z.record(z.string(), z.string()),
  }),
  z.strictObject({ type: z.literal("requestHint"), gateId: Id, tier: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.strictObject({
    type: z.literal("terminal"),
    host: z.string().min(1),
    cwd: z.string().min(1),
    line: z.string().min(1).max(1024),
  }),
]);
export type Action = z.infer<typeof Action>;

export const RejectionCode = z.enum([
  "invalid_input",
  "locked",
  "not_found",
  "rate_limited",
  "already_solved",
  "conflict",
  "unauthorized",
]);
export type RejectionCode = z.infer<typeof RejectionCode>;

export const Rejection = z.strictObject({
  code: RejectionCode,
  message: z.string(),
  retryAfterSeconds: z.number().int().min(1).optional(),
});
export type Rejection = z.infer<typeof Rejection>;
