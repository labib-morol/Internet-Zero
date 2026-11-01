import { z } from "zod";

/**
 * Safe document AST: the only representation of world Markdown that ever
 * reaches a client. Compiled at build time with an allowlist (§10.6);
 * anything outside this set fails the build.
 */
export type SafeNode =
  | { type: "root"; children: SafeNode[] }
  | { type: "paragraph"; children: SafeNode[] }
  | { type: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; children: SafeNode[] }
  | { type: "text"; value: string }
  | { type: "emphasis"; children: SafeNode[] }
  | { type: "strong"; children: SafeNode[] }
  | { type: "inlineCode"; value: string }
  | { type: "code"; lang?: string; value: string }
  | { type: "list"; ordered: boolean; start?: number; children: SafeNode[] }
  | { type: "listItem"; checked?: boolean | null; children: SafeNode[] }
  | { type: "blockquote"; children: SafeNode[] }
  | { type: "table"; align: Array<"left" | "right" | "center" | null>; children: SafeNode[] }
  | { type: "tableRow"; children: SafeNode[] }
  | { type: "tableCell"; children: SafeNode[] }
  | { type: "break" }
  | { type: "link"; url: string; title?: string; children: SafeNode[] }
  | { type: "image"; url: string; title?: string; alt?: string }
  | { type: "redaction"; text: string; removable: boolean }
  | { type: "signature"; keyId: string; fingerprint: string; valid: boolean; signer: string }
  | { type: "stamp"; text: string };

export const SafeNodeSchema: z.ZodType<SafeNode> = z.lazy(() =>
  z.union([
    z.strictObject({ type: z.literal("root"), children: z.array(SafeNodeSchema) }),
    z.strictObject({ type: z.literal("paragraph"), children: z.array(SafeNodeSchema) }),
    z.strictObject({ type: z.literal("heading"), depth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]), children: z.array(SafeNodeSchema) }),
    z.strictObject({ type: z.literal("text"), value: z.string() }),
    z.strictObject({ type: z.literal("emphasis"), children: z.array(SafeNodeSchema) }),
    z.strictObject({ type: z.literal("strong"), children: z.array(SafeNodeSchema) }),
    z.strictObject({ type: z.literal("inlineCode"), value: z.string() }),
    z.strictObject({ type: z.literal("code"), lang: z.string().optional(), value: z.string() }),
    z.strictObject({ type: z.literal("list"), ordered: z.boolean(), start: z.number().int().optional(), children: z.array(SafeNodeSchema) }),
    z.strictObject({ type: z.literal("listItem"), checked: z.boolean().nullish(), children: z.array(SafeNodeSchema) }),
    z.strictObject({ type: z.literal("blockquote"), children: z.array(SafeNodeSchema) }),
    z.strictObject({ type: z.literal("table"), align: z.array(z.union([z.literal("left"), z.literal("right"), z.literal("center"), z.null()])), children: z.array(SafeNodeSchema) }),
    z.strictObject({ type: z.literal("tableRow"), children: z.array(SafeNodeSchema) }),
    z.strictObject({ type: z.literal("tableCell"), children: z.array(SafeNodeSchema) }),
    z.strictObject({ type: z.literal("break") }),
    z.strictObject({ type: z.literal("link"), url: z.string(), title: z.string().optional(), children: z.array(SafeNodeSchema) }),
    z.strictObject({ type: z.literal("image"), url: z.string(), title: z.string().optional(), alt: z.string().optional() }),
    z.strictObject({ type: z.literal("redaction"), text: z.string(), removable: z.boolean() }),
    z.strictObject({ type: z.literal("signature"), keyId: z.string(), fingerprint: z.string(), valid: z.boolean(), signer: z.string() }),
    z.strictObject({ type: z.literal("stamp"), text: z.string() }),
  ])
);
