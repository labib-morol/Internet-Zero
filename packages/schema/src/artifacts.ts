import { z } from "zod";
import { Condition, Fragment, Id } from "./primitives.js";
import { SafeNodeSchema } from "./safe-ast.js";

export const ArtifactKind = z.enum([
  "repo",
  "commit",
  "issue",
  "user",
  "mail-message",
  "mail-thread",
  "archive-document",
  "terminal-file",
  "forum-post",
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

/** Artifact in the compiled bundle (§6.4, §7). Server-side only until visible. */
export const Artifact = z.strictObject({
  id: Id,
  host: z.string().min(1),
  path: z.string().min(1),
  kind: ArtifactKind,
  title: z.string().min(1),
  /** Plain text used for search indexing. */
  body: z.string(),
  /** Pre-rendered safe AST (§10.6). */
  ast: SafeNodeSchema,
  meta: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  /** Extra visibility condition on top of host reachability. */
  visibility: Condition.optional(),
  collectible: z.boolean().default(false),
});
export type Artifact = z.infer<typeof Artifact>;

export const Collectible = z.strictObject({
  artifactId: Id,
  label: z.string().min(1),
  fragment: Fragment.optional(),
});
export type Collectible = z.infer<typeof Collectible>;
