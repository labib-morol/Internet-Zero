import { z } from "zod";
import { Condition, Fact, Belief, Statement, Proof } from "./primitives.js";
import { Person, Org, Identity, EventDef } from "./entities.js";
import { Gate, Report, Hint } from "./gates.js";

export const ClockDef = z.strictObject({
  mode: z.enum(["session", "global"]),
  epoch: z.iso.datetime({ offset: true }),
});
export type ClockDef = z.infer<typeof ClockDef>;

export const HostDef = z.strictObject({
  host: z.string().min(1),
  service: z.enum(["forge", "mail", "archive", "terminal", "forum"]),
  title: z.string().optional(),
  requires: Condition.optional(),
});
export type HostDef = z.infer<typeof HostDef>;

/** world.yaml (§6.2). */
export const WorldYaml = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  format: z.literal("iz/1"),
  title: z.string().min(1),
  summary: z.string().min(1),
  license: z.literal("CC-BY-4.0"),
  /** Must not be a real TLD; checked against the vendored IANA list at build. */
  hostSuffix: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/),
  clock: ClockDef,
  hosts: z.array(HostDef).min(1),
  entry: z.string().min(1),
  reports: z.array(z.string()).min(1),
});
export type WorldYaml = z.infer<typeof WorldYaml>;

/** Aggregate of one world's source files, after YAML parsing (§6.1). */
export const WorldSource = z.strictObject({
  world: WorldYaml,
  people: z.array(Person),
  orgs: z.array(Org),
  identities: z.array(Identity),
  facts: z.array(Fact),
  beliefs: z.array(Belief),
  statements: z.array(Statement),
  proofs: z.array(Proof),
  gates: z.array(Gate),
  reports: z.array(Report),
  hints: z.array(Hint),
  events: z.array(EventDef),
});
export type WorldSource = z.infer<typeof WorldSource>;
