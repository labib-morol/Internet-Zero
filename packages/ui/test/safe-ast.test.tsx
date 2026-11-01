import "@testing-library/jest-dom/vitest";
import "@testing-library/jest-dom/vitest";
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SafeAst } from "../src/safe-ast.js";
import type { SafeNode } from "@iz/schema";

const root = (children: SafeNode[]): SafeNode => ({ type: "root", children });

describe("SafeAst renderer", () => {
  it("renders text, emphasis, strong, inline code and code blocks", () => {
    render(
      <SafeAst
        node={root([
          { type: "paragraph", children: [
            { type: "text", value: "plain " },
            { type: "emphasis", children: [{ type: "text", value: "italic" }] },
            { type: "strong", children: [{ type: "text", value: "bold" }] },
            { type: "inlineCode", value: "let x = 1" },
          ] },
          { type: "code", lang: "js", value: "let y = 2;\n" },
        ])}
      />
    );
    expect(screen.getByText(/plain/)).toBeInTheDocument();
    expect(screen.getByText("italic").tagName).toBe("EM");
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("let x = 1").tagName).toBe("CODE");
    expect(screen.getByText(/let y = 2/).closest("pre")).not.toBeNull();
  });

  it("renders headings, lists, blockquote, break and tables", () => {
    render(
      <SafeAst
        node={root([
          { type: "heading", depth: 2, children: [{ type: "text", value: "Section" }] },
          {
            type: "list",
            ordered: true,
            children: [{ type: "listItem", children: [{ type: "text", value: "one" }] }],
          },
          { type: "blockquote", children: [{ type: "paragraph", children: [{ type: "text", value: "quoted" }] }] },
          { type: "break" },
          {
            type: "table",
            align: [null],
            children: [
              { type: "tableRow", children: [{ type: "tableCell", children: [{ type: "text", value: "cell" }] }] },
            ],
          },
        ])}
      />
    );
    expect(screen.getByRole("heading", { level: 2, name: "Section" })).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("quoted").closest("blockquote")).not.toBeNull();
    expect(screen.getByRole("cell", { name: "cell" })).toBeInTheDocument();
  });

  it("never puts fixed-redaction text in the DOM; renders an opaque bar", () => {
    const { container } = render(
      <SafeAst node={root([{ type: "redaction", text: "SECRET-VALUE-123", removable: false }])} />
    );
    expect(container.querySelector("[data-redaction='fixed']")).not.toBeNull();
    expect(container.textContent).not.toContain("SECRET-VALUE-123");
  });

  it("hides removable redactions by default and reveals them only with inspectLayers", () => {
    const node: SafeNode = { type: "redaction", text: "layer text", removable: true };
    const hidden = render(<SafeAst node={root([node])} />);
    expect(hidden.container.querySelector("[data-redaction='removable-hidden']")).not.toBeNull();
    expect(hidden.container.textContent).not.toContain("layer text");
    hidden.unmount();

    const revealed = render(<SafeAst node={root([node])} inspectLayers />);
    expect(revealed.container.querySelector("[data-redaction='removable']")?.textContent).toBe("layer text");
  });

  it("renders links that dispatch in-game and never navigate", () => {
    const onOpenLink = vi.fn();
    render(
      <SafeAst
        node={root([
          { type: "link", url: "mail.pinecone.pcp/inbox", children: [{ type: "text", value: "open mail" }] },
        ])}
        onOpenLink={onOpenLink}
      />
    );
    const link = screen.getByText("open mail");
    expect(link.tagName).toBe("A");
    const before = window.location.href;
    fireEvent.click(link);
    expect(onOpenLink).toHaveBeenCalledWith("mail.pinecone.pcp/inbox");
    expect(window.location.href).toBe(before); // no navigation
  });

  it("renders images as placeholder boxes with alt text (assets not wired)", () => {
    render(<SafeAst node={root([{ type: "image", url: "a.photo", alt: "server room" }])} />);
    const placeholder = screen.getByRole("img", { name: "server room" });
    expect(placeholder.className).toContain("iz-img-placeholder");
    expect(placeholder.querySelector("img")).toBeNull();
  });

  it("styles signature nodes and stamps", () => {
    render(
      <SafeAst
        node={root([
          { type: "signature", keyId: "0xDEAD", fingerprint: "aa bb cc", valid: true, signer: "R. Vance" },
          { type: "stamp", text: "RECEIVED" },
        ])}
      />
    );
    const sig = screen.getByText(/R\. Vance/).closest(".iz-signature");
    expect(sig).not.toBeNull();
    expect(sig?.className).not.toContain("iz-signature--invalid");
    expect(screen.getByText("RECEIVED").className).toContain("iz-stamp");
  });

  it("marks invalid signatures", () => {
    render(
      <SafeAst
        node={root([{ type: "signature", keyId: "k", fingerprint: "f", valid: false, signer: "X" }])}
      />
    );
    expect(screen.getByText(/X/).closest(".iz-signature")?.className).toContain("iz-signature--invalid");
  });
});
