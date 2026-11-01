/**
 * Terminal line parser (§10.5). Pure syntax: argv, pipes (| grep | head | tail),
 * and `> overlay-file` redirection. No execution here.
 */

export type Redirection = { path: string } | undefined;

export type Pipeline = {
  /** First command's argv. */
  argv: string[];
  /** Trailing filter stages; only grep/head/tail are allowed. */
  filters: Array<{ cmd: "grep" | "head" | "tail"; argv: string[] }>;
  /** `> path` target inside the team overlay (path without leading host). */
  redirect: Redirection;
};

export class ParseError extends Error {
  readonly kind: "empty" | "unsupported" | "bad_redirect" | "too_long";
  constructor(kind: ParseError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

export const MAX_LINE_LENGTH = 1024;
const MAX_OUTPUT = 64 * 1024;

export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let hasToken = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) {
        quote = undefined;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken || current) tokens.push(current);
      current = "";
      hasToken = false;
      continue;
    }
    current += ch;
  }
  if (quote) throw new ParseError("unsupported", "unterminated quote");
  if (hasToken || current) tokens.push(current);
  return tokens;
}

/** Split a token list on a top-level separator token ("|" or ">"). */
function splitOn(tokens: string[], sep: string): string[][] {
  const parts: string[][] = [[]];
  for (const t of tokens) {
    if (t === sep) parts.push([]);
    else parts[parts.length - 1]!.push(t);
  }
  return parts;
}

export function parseLine(raw: string): Pipeline {
  if (raw.length > MAX_LINE_LENGTH) throw new ParseError("too_long", "command too long (1 KB max)");
  const tokens = tokenize(raw);
  if (tokens.length === 0) throw new ParseError("empty", "empty command");

  // Redirection must be the last token pair: `> path`.
  let redirect: Redirection;
  const gtIndex = tokens.indexOf(">");
  if (gtIndex !== -1) {
    if (gtIndex !== tokens.length - 2) {
      throw new ParseError("bad_redirect", "usage: command > file (redirection must be last)");
    }
    const target = tokens[gtIndex + 1]!;
    if (target.startsWith("/")) {
      throw new ParseError("bad_redirect", "redirection writes to your overlay: use a relative path");
    }
    redirect = { path: target };
    tokens.splice(gtIndex);
  }

  const stages = splitOn(tokens, "|");
  const first = stages[0]!;
  if (first.length === 0) throw new ParseError("unsupported", "empty command before |");
  const argv = first;
  const filters = stages.slice(1).map((stage) => {
    const cmd = stage[0];
    if (cmd !== "grep" && cmd !== "head" && cmd !== "tail") {
      throw new ParseError("unsupported", `only | grep, | head, | tail are allowed (got | ${cmd ?? "?"})`);
    }
    return { cmd: cmd as "grep" | "head" | "tail", argv: stage };
  });
  return { argv, filters, redirect };
}

export { MAX_OUTPUT };
