import { describe, expect, it } from "vitest";
import { compileMarkdown, safeText, scanStringSafety, MarkdownError } from "../src/markdown.js";

const HOSTS = new Set(["forge.fix.pcp", "mail.fix.pcp"]);

describe("compileMarkdown — safe-AST allowlist", () => {
  it("compiles common markdown into allowlisted nodes", () => {
    const ast = compileMarkdown("# Title\n\nHello **world** and `code`.\n\n- one\n- two\n\n> quoted\n");
    expect(ast.type).toBe("root");
    expect(ast.children.map((n) => n.type)).toEqual(["heading", "paragraph", "list", "blockquote"]);
  });

  it("parses gfm tables", () => {
    const ast = compileMarkdown("| a | b |\n| - | - |\n| 1 | 2 |\n");
    expect(ast.children[0]?.type).toBe("table");
  });

  it("rejects raw html nodes as a safety error", () => {
    expect(() => compileMarkdown("hello <div onclick=\"x\">bad</div>")).toThrowError(MarkdownError);
    try {
      compileMarkdown("<script>alert(1)</script>");
      expect.unreachable();
    } catch (error) {
      expect((error as MarkdownError).kind).toBe("safety");
    }
  });

  it("rejects node types outside the allowlist", () => {
    for (const markdown of [
      "Some text\n\n---\n\nMore text", // thematicBreak
      "[ref]: https://example.com", // definition
      "Term ~struck~", // delete (gfm)
      "Footnote[^1]\n\n[^1]: note", // footnote
    ]) {
      try {
        compileMarkdown(markdown);
        expect.unreachable(`expected failure for: ${markdown}`);
      } catch (error) {
        expect(error).toBeInstanceOf(MarkdownError);
        expect((error as MarkdownError).kind).toBe("allowlist");
      }
    }
  });

  it("rejects event-handler-looking text and javascript: URLs anywhere in the document", () => {
    expect(() => compileMarkdown("click [x](javascript:alert(1))", { allowedHosts: HOSTS })).toThrowError(MarkdownError);
    expect(() => scanStringSafety("innocent on Tuesday", "label")).not.toThrow();
    expect(() => scanStringSafety("onclick=alert(1)", "label")).toThrowError(MarkdownError);
  });
});

describe("compileMarkdown — link URLs", () => {
  it("accepts links to declared hosts with or without a scheme and normalizes them", () => {
    const ast = compileMarkdown("[repo](https://forge.fix.pcp/acme/notes) and [home](forge.fix.pcp)", { allowedHosts: HOSTS });
    const paragraph = ast.children[0]!;
    if (paragraph.type !== "paragraph") throw new Error("expected paragraph");
    const links = paragraph.children.filter((n) => n.type === "link");
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ type: "link", url: "forge.fix.pcp/acme/notes" });
    expect(links[1]).toMatchObject({ type: "link", url: "forge.fix.pcp" });
  });

  it("rejects links to undeclared hosts", () => {
    try {
      compileMarkdown("[x](https://evil.example.com/path)", { allowedHosts: HOSTS });
      expect.unreachable();
    } catch (error) {
      expect((error as MarkdownError).kind).toBe("link");
    }
  });
});

describe("compileMarkdown — image assets", () => {
  it("rewrites image references to content-addressed ids", () => {
    const ast = compileMarkdown("![sticker](assets/sticker.png)", { resolveAsset: (ref) => (ref === "assets/sticker.png" ? "ca".repeat(32) : null) });
    expect(ast.children[0]).toMatchObject({ type: "paragraph" });
    const paragraph = ast.children[0]!;
    if (paragraph.type !== "paragraph") throw new Error("expected paragraph");
    expect(paragraph.children[0]).toMatchObject({ type: "image", url: "ca".repeat(32), alt: "sticker" });
  });

  it("rejects unresolvable image references", () => {
    expect(() => compileMarkdown("![x](assets/missing.png)", { resolveAsset: () => null })).toThrowError(MarkdownError);
  });
});

describe("custom markers", () => {
  it("parses redaction, signature and stamp markers inside text", () => {
    const ast = compileMarkdown(
      "Before [[redaction:secret note|removable]] mid [[redaction:other|fixed]] [[signature:K1|AA:BB|valid|id.mara]] [[stamp:INTERNAL]] after",
    );
    const paragraph = ast.children[0]!;
    if (paragraph.type !== "paragraph") throw new Error("expected paragraph");
    const types = paragraph.children.map((n) => n.type);
    expect(types).toEqual(["text", "redaction", "text", "redaction", "text", "signature", "text", "stamp", "text"]);
    const redaction = paragraph.children[1]!;
    if (redaction.type !== "redaction") throw new Error("expected redaction");
    expect(redaction).toEqual({ type: "redaction", text: "secret note", removable: true });
    const signature = paragraph.children[5]!;
    if (signature.type !== "signature") throw new Error("expected signature");
    expect(signature).toEqual({ type: "signature", keyId: "K1", fingerprint: "AA:BB", valid: true, signer: "id.mara" });
  });

  it("leaves markers literal inside code and inlineCode", () => {
    const ast = compileMarkdown("Keep `[[stamp:LITERAL]]` and:\n\n```\n[[redaction:x|fixed]]\n```\n");
    const paragraph = ast.children[0]!;
    if (paragraph.type !== "paragraph") throw new Error("expected paragraph");
    expect(paragraph.children[0]).toEqual({ type: "text", value: "Keep " });
    expect(paragraph.children[1]).toEqual({ type: "inlineCode", value: "[[stamp:LITERAL]]" });
    const code = ast.children[1]!;
    if (code.type !== "code") throw new Error("expected code");
    expect(code.value).toBe("[[redaction:x|fixed]]");
  });

  it("rejects malformed markers", () => {
    expect(() => compileMarkdown("[[redaction:no-mode]]")).toThrowError(/takes exactly/);
    expect(() => compileMarkdown("[[redaction:x|wrong]]")).toThrowError(/mode must be/);
    expect(() => compileMarkdown("[[signature:only-one-arg]]")).toThrowError(/takes exactly/);
    expect(() => compileMarkdown("[[stamp:a|b]]")).toThrowError(/takes exactly TEXT/);
  });
});

describe("safeText", () => {
  it("extracts plain text and never leaks redacted content", () => {
    const ast = compileMarkdown("Visible [[redaction:hidden-secret|fixed]] end");
    const text = safeText(ast);
    expect(text).toContain("Visible");
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("hidden-secret");
  });

  it("includes link urls and stamp text for search", () => {
    const ast = compileMarkdown("See [repo](https://forge.fix.pcp/acme/notes). [[stamp:ACME]]", { allowedHosts: HOSTS });
    const text = safeText(ast);
    expect(text).toContain("forge.fix.pcp/acme/notes");
    expect(text).toContain("[stamp: ACME]");
  });
});
