import { z } from "zod";

/**
 * Identity primitives for world sources and bundles (master prompt §6.3).
 * Every id is a string with a type prefix: p. o. id. f. a. g. r. h. e.
 */
export const Id = z.string().regex(/^[a-z]+\.[a-z0-9][a-z0-9._-]{0,63}$/);
export type Id = z.infer<typeof Id>;

/** ISO-8601 timestamp with mandatory offset. */
export const IsoTime = z.iso.datetime({ offset: true });
export type IsoTime = z.infer<typeof IsoTime>;

export const Proposition = z.strictObject({
  subject: Id,
  /** e.g. "retainedDataFor", "authorOf", "aliasOf" */
  predicate: z.string().min(1),
  object: z.union([Id, z.string(), z.number(), z.boolean()]),
});
export type Proposition = z.infer<typeof Proposition>;

export const Fact = z.strictObject({
  id: Id,
  proposition: Proposition,
  validFrom: IsoTime.optional(),
  validTo: IsoTime.optional(),
  required: z.boolean().default(false),
  secrecy: z.enum(["public", "hidden", "secret"]).default("hidden"),
  /** Author note, never shown to players. */
  note: z.string().optional(),
});
export type Fact = z.infer<typeof Fact>;

export const Belief = z.strictObject({
  holder: Id,
  proposition: Proposition,
  stance: z.enum(["knows", "believes", "believes_false", "suspects", "hides", "lies_about"]),
  since: IsoTime.optional(),
});
export type Belief = z.infer<typeof Belief>;

export const Statement = z.strictObject({
  artifact: Id,
  speaker: Id,
  proposition: Proposition,
  truthful: z.boolean(),
  /** Required when truthful. */
  fact: Id.optional(),
});
export type Statement = z.infer<typeof Statement>;

export const Proof = z.strictObject({
  fact: Id,
  artifacts: z.array(Id).min(1),
  strength: z.enum(["direct", "corroborating"]),
});
export type Proof = z.infer<typeof Proof>;

/** Recursive progression condition (master prompt §6.3). */
export type Cond =
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond }
  | { gateSolved: string }
  | { evidenceCollected: string }
  | { factEstablished: string }
  | { timeReached: string }
  | { teamSizeAtLeast: number };

export const Condition: z.ZodType<Cond> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(Condition) }),
    z.strictObject({ any: z.array(Condition) }),
    z.strictObject({ not: Condition }),
    z.strictObject({ gateSolved: Id }),
    z.strictObject({ evidenceCollected: Id }),
    z.strictObject({ factEstablished: Id }),
    z.strictObject({ timeReached: IsoTime }),
    z.strictObject({ teamSizeAtLeast: z.number().int().min(1) }),
  ])
);

/** Selection over an artifact's rendered text or geometry (master prompt §7). */
export const Fragment = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("lines"), from: z.number().int().min(1), to: z.number().int().min(1) }),
  z.strictObject({ kind: z.literal("range"), start: z.number().int().min(0), end: z.number().int().min(0) }),
  z.strictObject({
    kind: z.literal("region"),
    x: z.number(),
    y: z.number(),
    w: z.number().min(0),
    h: z.number().min(0),
  }),
]);
export type Fragment = z.infer<typeof Fragment>;

export const LinkRelation = z.enum(["supports", "contradicts", "same_identity", "precedes", "derived_from"]);
export type LinkRelation = z.infer<typeof LinkRelation>;
