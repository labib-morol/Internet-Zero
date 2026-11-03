import { z } from "zod";
import { WorldYaml } from "./world.js";
import { Person, Org, Identity, Asset, EventDef, ForgeRepo, Mailbox } from "./entities.js";
import { Fact, Belief, Statement, Proof } from "./primitives.js";
import { Artifact } from "./artifacts.js";
import { BundleGate, BundleReport, Hint } from "./gates.js";
import { ForumBoard } from "./forum.js";

/** Server-only section of a bundle: canonical truth (§6.4). Never sent to clients. */
export const Canon = z.strictObject({
  facts: z.array(Fact),
  beliefs: z.array(Belief),
  statements: z.array(Statement),
  proofs: z.array(Proof),
});
export type Canon = z.infer<typeof Canon>;

export const WorldBundle = z.strictObject({
  world: WorldYaml,
  entities: z.array(z.union([Person, Org])),
  identities: z.array(Identity),
  artifacts: z.array(Artifact),
  gates: z.array(BundleGate),
  reports: z.array(BundleReport),
  hints: z.array(Hint),
  events: z.array(EventDef),
  canon: Canon,
  assets: z.array(Asset),
  /** Structured forge sources for view building (server-side; never sent raw). */
  forge: z.array(ForgeRepo).default([]),
  /** Structured mail sources for view building (server-side; never sent raw). */
  mailboxes: z.array(Mailbox).default([]),
  /** Structured GHOSTBOARD sources for view building (server-side; never sent raw). */
  forum: z.array(ForumBoard).default([]),
  /** Salt for answer hashes: sha256(bundleSalt + ":" + gateOrSlotId + ":" + normalized). */
  bundleSalt: z.string().min(16),
  /** sha256 of the canonical JSON of the bundle without this field. */
  bundleHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type WorldBundle = z.infer<typeof WorldBundle>;
