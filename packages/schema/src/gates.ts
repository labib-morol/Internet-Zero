import { z } from "zod";
import { Condition, Id } from "./primitives.js";
import type { Cond } from "./primitives.js";
import { Normalizer } from "./normalize.js";

/** Gate check in world SOURCE: plaintext answers, salted-hashed at build. */
export const SourceGateCheck = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("answer"),
    normalize: z.array(Normalizer).default(["nfkc", "lower", "trim", "collapse"]),
    answers: z.array(z.string()).min(1),
  }),
  z.strictObject({ kind: z.literal("report"), report: Id }),
  z.strictObject({
    kind: z.literal("evidenceSet"),
    mustCollect: z.array(Id).min(0),
    mustLink: z
      .array(z.strictObject({ from: Id, to: Id, relation: z.string() }))
      .default([]),
  }),
  z.strictObject({ kind: z.literal("terminal"), mustHaveRead: z.array(z.string()).min(1), host: z.string() }),
]);
export type SourceGateCheck = z.infer<typeof SourceGateCheck>;

/** Gate check in the compiled BUNDLE: answers replaced by salted hashes (§6.4). */
export const BundleGateCheck = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("answer"),
    normalize: z.array(Normalizer),
    answerHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1),
  }),
  z.strictObject({ kind: z.literal("report"), report: Id }),
  z.strictObject({
    kind: z.literal("evidenceSet"),
    mustCollect: z.array(Id),
    mustLink: z.array(z.strictObject({ from: Id, to: Id, relation: z.string() })),
  }),
  z.strictObject({ kind: z.literal("terminal"), mustHaveRead: z.array(z.string()), host: z.string() }),
]);
export type BundleGateCheck = z.infer<typeof BundleGateCheck>;

function gateFields<C extends z.ZodTypeAny>(check: C) {
  return {
    id: Id,
    title: z.string().min(1),
    requires: Condition.optional(),
    check,
    /** Ids of hosts, artifacts, events, reports this gate makes visible. */
    unlocks: z.array(Id).default([]),
    // Solving must never subtract; a world author wanting penalties models
    // them via hint costs instead.
    score: z.number().int().min(0).default(100),
  };
}

export const Gate = z.strictObject(gateFields(SourceGateCheck));
export type Gate = z.infer<typeof Gate>;

export const BundleGate = z.strictObject(gateFields(BundleGateCheck));
export type BundleGate = z.infer<typeof BundleGate>;

export const ReportSlot = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["identity", "date", "choice", "text"]),
  options: z.array(z.string()).optional(),
  /** The fact this slot establishes. */
  fact: Id,
  /** Plaintext answers, source only. */
  answers: z.array(z.string()).min(1),
});
export type ReportSlot = z.infer<typeof ReportSlot>;

export const BundleReportSlot = ReportSlot.omit({ answers: true }).extend({
  answerHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1),
});
export type BundleReportSlot = z.infer<typeof BundleReportSlot>;

export const Report = z.strictObject({
  id: Id,
  title: z.string().min(1),
  groups: z
    .array(z.strictObject({ id: z.string().min(1), slots: z.array(ReportSlot).min(1) }))
    .min(1),
});
export type Report = z.infer<typeof Report>;

export const BundleReport = z.strictObject({
  id: Id,
  title: z.string().min(1),
  groups: z
    .array(z.strictObject({ id: z.string().min(1), slots: z.array(BundleReportSlot).min(1) }))
    .min(1),
});
export type BundleReport = z.infer<typeof BundleReport>;

export const HintTier = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type HintTier = z.infer<typeof HintTier>;

export const Hint = z.strictObject({
  gate: Id,
  tier: HintTier,
  text: z.string().min(1),
  cost: z.number().int().min(0),
});
export type Hint = z.infer<typeof Hint>;

/** Normalization chain per report slot type — the compiler and runtime must use the same one. */
export const SlotNormalizers: Record<"identity" | "date" | "choice" | "text", Normalizer[]> = {
  identity: ["nfkc", "lower", "trim", "collapse"],
  date: ["nfkc", "trim"],
  choice: ["nfkc", "lower", "trim", "collapse"],
  text: ["nfkc", "lower", "trim", "collapse"],
};

/** Answer-check inputs the runtime needs at submission time. */
export type AnswerCheckContext = {
  normalize: Normalizer[];
  answerHashes: readonly string[];
  salt: string;
};

export type GateRequirement = Cond;
