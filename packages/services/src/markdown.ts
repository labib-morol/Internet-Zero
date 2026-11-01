import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { PhrasingContent, RootContent } from "mdast";
import type { SafeNode } from "@iz/schema";

/**
 * Markdown -> SafeNode compiler (master prompt section 10.6).
 *
 * World Markdown is parsed with remark-parse + remark-gfm and transformed into
 * the frozen safe AST from @iz/schema. Everything outside the allowlist fails:
 * raw `html` nodes and any other unlisted node type (footnotes, definitions,
 * strikethrough, thematic breaks, ...) raise a MarkdownError.
 *
 * Authoring conventions for custom nodes, scanned inside inline text:
 *   [[redaction:TEXT|removable]]  [[redaction:TEXT|fixed]]
 *   [[signature:keyId|fingerprint|valid|signerId]]
 *   [[stamp:TEXT]]
 * Markers inside code / inlineCode are left literal. Malformed markers fail
 * the build (they are authoring-schema errors).
 *
 * Link URLs must point at hosts declared in world.yaml (host part must match
 * exactly, path optional; an optional scheme is stripped). Image URLs must be
 * asset references resolvable through the `resolveAsset` callback.
 */

/** Categories of content failures, mapped to build-check numbers by the compiler. */
export type MarkdownErrorKind = "safety" | "allowlist" | "link" | "image" | "marker";

export class MarkdownError extends Error {
  readonly kind: MarkdownErrorKind;
  readonly line: number | undefined;
  readonly column: number | undefined;

  constructor(kind: MarkdownErrorKind, message: string, line?: number, column?: number) {
    super(line === undefined ? message : `${message} (line ${line}${column === undefined ? "" : `, column ${column}`})`);
    this.name = "MarkdownError";
    this.kind = kind;
    this.line = line;
    this.column = column;
  }
}

// ---------------------------------------------------------------------------
// Content safety scanning (build check 11: no HTML/script/iframe/event-handler
// attributes or javascript: URLs in any content).
// ---------------------------------------------------------------------------

const RE_HTML_TAG =
  /<\s*\/?\s*(?:script|iframe|html|head|body|title|object|embed|style|link|meta|base|form|input|button|select|textarea|svg|math|template|frame|frameset|applet|portal|slot|audio|video|source|track|marquee|details|dialog|canvas|noscript|plaintext)\b/i;
const RE_EVENT_HANDLER = /\bon[a-z]{3,}\s*=/i;
const RE_DANGEROUS_URL = /(?:javascript|vbscript)\s*:/i;
const RE_DATA_HTML = /data:\s*text\/html/i;

/** Throws a safety MarkdownError if the string contains HTML-ish content. */
export function scanStringSafety(value: string, label: string): void {
  if (RE_HTML_TAG.test(value)) {
    throw new MarkdownError("safety", `${label}: HTML markup is not allowed in world content`);
  }
  if (RE_EVENT_HANDLER.test(value)) {
    throw new MarkdownError("safety", `${label}: event-handler attributes are not allowed in world content`);
  }
  if (RE_DANGEROUS_URL.test(value) || RE_DATA_HTML.test(value)) {
    throw new MarkdownError("safety", `${label}: javascript:/vbscript:/data:text/html URLs are not allowed in world content`);
  }
}

// ---------------------------------------------------------------------------
// Custom markers
// ---------------------------------------------------------------------------

const MARKER_RE = /\[\[(redaction|signature|stamp):([^\]]*)\]\]/g;

function markerArgs(raw: string, pos: Pos): string[] {
  if (raw.length === 0 || /\[\]/.test(raw)) {
    throw new MarkdownError("marker", `malformed marker "[[${raw}]]"`, pos.line, pos.column);
  }
  return raw.split("|");
}

function parseMarker(kind: string, argsRaw: string, pos: Pos): SafeNode {
  const args = markerArgs(argsRaw, pos);
  switch (kind) {
    case "redaction": {
      if (args.length !== 2 || (args[0] !== undefined && args[0].length === 0)) {
        throw new MarkdownError("marker", `[[redaction:...]] takes exactly TEXT|removable or TEXT|fixed`, pos.line, pos.column);
      }
      const text = args[0] ?? "";
      const mode = args[1];
      if (mode !== "removable" && mode !== "fixed") {
        throw new MarkdownError("marker", `[[redaction:...]] mode must be "removable" or "fixed", got "${mode ?? ""}"`, pos.line, pos.column);
      }
      return { type: "redaction", text, removable: mode === "removable" };
    }
    case "signature": {
      if (args.length !== 4) {
        throw new MarkdownError("marker", `[[signature:...]] takes exactly keyId|fingerprint|valid|signerId`, pos.line, pos.column);
      }
      const keyId = args[0] ?? "";
      const fingerprint = args[1] ?? "";
      const validRaw = (args[2] ?? "").toLowerCase();
      const signer = args[3] ?? "";
      if (keyId.length === 0 || fingerprint.length === 0 || signer.length === 0) {
        throw new MarkdownError("marker", `[[signature:...]] fields keyId, fingerprint and signerId must be non-empty`, pos.line, pos.column);
      }
      if (validRaw !== "valid" && validRaw !== "invalid") {
        throw new MarkdownError("marker", `[[signature:...]] validity must be "valid" or "invalid", got "${args[2] ?? ""}"`, pos.line, pos.column);
      }
      return { type: "signature", keyId, fingerprint, valid: validRaw === "valid", signer };
    }
    case "stamp": {
      if (args.length !== 1 || (args[0] !== undefined && args[0].length === 0)) {
        throw new MarkdownError("marker", `[[stamp:...]] takes exactly TEXT`, pos.line, pos.column);
      }
      return { type: "stamp", text: args[0] ?? "" };
    }
    default:
      throw new MarkdownError("marker", `unknown marker kind "${kind}"`, pos.line, pos.column);
  }
}

interface Pos {
  line: number | undefined;
  column: number | undefined;
}

function nodePos(node: { position?: { start?: { line: number; column: number } } | null }): Pos {
  const start = node.position?.start;
  return start ? { line: start.line, column: start.column } : { line: undefined, column: undefined };
}

/** Offset position by a number of characters (for marker errors inside text). */
function offsetPos(pos: Pos, value: string, index: number): Pos {
  if (pos.line === undefined) return { line: undefined, column: undefined };
  let line = pos.line;
  let lastBreak = -1;
  for (let i = 0; i < index && i < value.length; i++) {
    if (value[i] === "\n") {
      line += 1;
      lastBreak = i;
    }
  }
  const column = lastBreak === -1 ? (pos.column ?? 1) + index : index - lastBreak;
  return { line, column };
}

/** Splits a text value into SafeNodes, turning custom markers into custom nodes. */
function splitMarkers(value: string, pos: Pos): SafeNode[] {
  const out: SafeNode[] = [];
  let last = 0;
  for (const match of value.matchAll(MARKER_RE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: "text", value: value.slice(last, index) });
    out.push(parseMarker(match[1] ?? "", match[2] ?? "", offsetPos(pos, value, index)));
    last = index + match[0].length;
  }
  if (last < value.length || out.length === 0) out.push({ type: "text", value: value.slice(last) });
  return out;
}

// ---------------------------------------------------------------------------
// mdast -> SafeNode transformation
// ---------------------------------------------------------------------------

type AnyMdastNode = RootContent | PhrasingContent;

export interface CompileOptions {
  /** Declared in-game hosts; link URLs must point at one of these. */
  allowedHosts?: ReadonlySet<string>;
  /** Resolves an image/asset reference to its content-addressed id, or null. */
  resolveAsset?: (ref: string) => string | null;
}

function transformPhrasing(nodes: readonly PhrasingContent[], opts: CompileOptions): SafeNode[] {
  const out: SafeNode[] = [];
  for (const node of nodes) out.push(...transformInline(node, opts));
  return out;
}

function transformInline(node: PhrasingContent, opts: CompileOptions): SafeNode[] {
  const pos = nodePos(node);
  switch (node.type) {
    case "text":
      return splitMarkers(node.value, pos);
    case "emphasis":
      return [{ type: "emphasis", children: transformPhrasing(node.children, opts) }];
    case "strong":
      return [{ type: "strong", children: transformPhrasing(node.children, opts) }];
    case "inlineCode":
      return [{ type: "inlineCode", value: node.value }];
    case "break":
      return [{ type: "break" }];
    case "link": {
      const url = normalizeLinkUrl(node.url, pos, opts);
      const link: SafeNode = { type: "link", url, children: transformPhrasing(node.children, opts) };
      if (node.title !== undefined && node.title !== null) link.title = node.title;
      return [link];
    }
    case "image": {
      const url = resolveImageUrl(node.url, pos, opts);
      const image: SafeNode = { type: "image", url };
      if (node.title !== undefined && node.title !== null) image.title = node.title;
      if (node.alt !== undefined && node.alt !== null) image.alt = node.alt;
      return [image];
    }
    case "html":
      throw new MarkdownError("safety", `raw HTML node "<${node.value.trim().slice(0, 60)}>" is not allowed`, pos.line, pos.column);
    default:
      throw new MarkdownError("allowlist", `node type "${nodeTypeOf(node)}" is not in the safe-AST allowlist`, pos.line, pos.column);
  }
}

function nodeTypeOf(node: AnyMdastNode): string {
  return typeof node.type === "string" ? node.type : "unknown";
}

function normalizeRef(raw: string): string {
  return raw.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
}

function normalizeLinkUrl(raw: string, pos: Pos, opts: CompileOptions): string {
  const url = raw.trim();
  scanStringSafety(url, "link URL");
  // Strip any scheme; in-game URLs are host/path with no real navigation.
  const withoutScheme = url.replace(/^https?:\/\//i, "");
  const slash = withoutScheme.indexOf("/");
  const host = slash === -1 ? withoutScheme : withoutScheme.slice(0, slash);
  if (host.length === 0 || !opts.allowedHosts?.has(host)) {
    throw new MarkdownError("link", `link target "${url}" does not point at a host declared in world.yaml`, pos.line, pos.column);
  }
  return withoutScheme;
}

function resolveImageUrl(raw: string, pos: Pos, opts: CompileOptions): string {
  const ref = raw.trim();
  scanStringSafety(ref, "image URL");
  const id = opts.resolveAsset?.(normalizeRef(ref)) ?? null;
  if (id === null) {
    throw new MarkdownError("image", `image reference "${ref}" does not resolve to a world asset`, pos.line, pos.column);
  }
  return id;
}

function transformBlock(node: RootContent, opts: CompileOptions): SafeNode {
  const pos = nodePos(node);
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", children: transformPhrasing(node.children, opts) };
    case "heading":
      return { type: "heading", depth: node.depth, children: transformPhrasing(node.children, opts) };
    case "code": {
      const n: SafeNode = { type: "code", value: node.value };
      if (node.lang !== undefined && node.lang !== null && node.lang.length > 0) n.lang = node.lang;
      return n;
    }
    case "list":
      return {
        type: "list",
        ordered: node.ordered === true,
        ...(node.start === null || node.start === undefined || !node.ordered ? {} : { start: node.start }),
        children: node.children.map((item) => {
          const childNode: SafeNode = {
            type: "listItem",
            children: item.children.map((child) => transformBlock(child, opts)),
          };
          if (item.checked !== undefined && item.checked !== null) childNode.checked = item.checked;
          return childNode;
        }),
      };
    case "blockquote":
      return { type: "blockquote", children: node.children.map((child) => transformBlock(child, opts)) };
    case "table":
      return {
        type: "table",
        align: node.align ?? [],
        children: node.children.map((row) => ({
          type: "tableRow",
          children: row.children.map((cell) => ({ type: "tableCell", children: transformPhrasing(cell.children, opts) })),
        })),
      };
    case "thematicBreak":
    case "definition":
    case "footnoteDefinition":
    case "yaml":
      throw new MarkdownError("allowlist", `node type "${node.type}" is not in the safe-AST allowlist`, pos.line, pos.column);
    case "html":
      throw new MarkdownError("safety", `raw HTML node "<${node.value.trim().slice(0, 60)}>" is not allowed`, pos.line, pos.column);
    default:
      throw new MarkdownError("allowlist", `node type "${nodeTypeOf(node)}" is not in the safe-AST allowlist`, pos.line, pos.column);
  }
}

const processor = unified().use(remarkParse).use(remarkGfm);

/** A safe-AST root node (the top of every artifact AST). */
export type SafeRoot = Extract<SafeNode, { type: "root" }>;

/**
 * Compiles world Markdown into the safe AST root. Throws MarkdownError on any
 * safety, allowlist, link or image violation.
 */
export function compileMarkdown(markdown: string, opts: CompileOptions = {}): SafeRoot {
  scanStringSafety(markdown, "document");
  const tree = processor.parse(markdown);
  const children: SafeNode[] = [];
  for (const child of tree.children) children.push(transformBlock(child, opts));
  return { type: "root", children };
}

// ---------------------------------------------------------------------------
// Plain-text extraction (the artifact `body` used for search)
// ---------------------------------------------------------------------------

/**
 * Extracts the plain text of a SafeNode for search indexing. Redacted text is
 * never included (it would leak hidden content through search); redactions
 * become a "[REDACTED]" placeholder. Link and image URLs are kept so that
 * references between documents remain findable.
 */
export function safeText(node: SafeNode): string {
  switch (node.type) {
    case "root":
      return node.children.map(safeText).join("\n");
    case "paragraph":
    case "tableCell":
      return node.children.map(safeText).join("");
    case "heading":
      return node.children.map(safeText).join("");
    case "text":
      return node.value;
    case "emphasis":
    case "strong":
      return node.children.map(safeText).join("");
    case "inlineCode":
    case "code":
      return node.value;
    case "list":
      return node.children.map(safeText).join("\n");
    case "listItem":
      return `- ${node.children.map(safeText).join("\n")}`;
    case "blockquote": {
      const inner = node.children.map(safeText).join("\n");
      return inner
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }
    case "table":
      return node.children.map(safeText).join("\n");
    case "tableRow":
      return node.children.map(safeText).join(" | ");
    case "break":
      return "\n";
    case "link":
      return `${node.children.map(safeText).join("")} (${node.url})`;
    case "image":
      return `${node.alt ?? ""} (${node.url})`;
    case "redaction":
      return "[REDACTED]";
    case "signature":
      return `[signature ${node.keyId} ${node.valid ? "valid" : "invalid"} by ${node.signer}]`;
    case "stamp":
      return `[stamp: ${node.text}]`;
  }
}

/** Builds an empty safe-AST root (for artifacts without a document body). */
export function emptyRoot(): SafeRoot {
  return { type: "root", children: [] };
}

/** Builds a safe-AST root holding one plain code block (terminal files). */
export function codeRoot(value: string): SafeRoot {
  return { type: "root", children: [{ type: "code", value }] };
}
