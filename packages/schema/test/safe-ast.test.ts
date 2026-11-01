import { describe, expect, it } from "vitest";
import { SafeNodeSchema } from "../src/safe-ast.js";

describe("SafeNodeSchema", () => {
  it("accepts a nested allowlisted tree", () => {
    const doc = {
      type: "root",
      children: [
        { type: "heading", depth: 2, children: [{ type: "text", value: "Pinecone Print Co." }] },
        {
          type: "paragraph",
          children: [
            { type: "text", value: "Our shop cat " },
            { type: "strong", children: [{ type: "text", value: "Biscuit" }] },
            { type: "inlineCode", value: "cat.jpg" },
          ],
        },
        {
          type: "list",
          ordered: false,
          children: [{ type: "listItem", children: [{ type: "text", value: "est. 2009" }] }],
        },
      ],
    };
    expect(SafeNodeSchema.safeParse(doc).success).toBe(true);
  });

  it("accepts the custom redaction, signature and stamp nodes", () => {
    expect(
      SafeNodeSchema.safeParse({ type: "redaction", text: "10-year NDA", removable: true }).success
    ).toBe(true);
    expect(
      SafeNodeSchema.safeParse({ type: "signature", keyId: "0xDEAD", fingerprint: "AB:CD", valid: true, signer: "id.ines" }).success
    ).toBe(true);
    expect(SafeNodeSchema.safeParse({ type: "stamp", text: "PAID" }).success).toBe(true);
  });

  it("rejects anything outside the allowlist", () => {
    expect(SafeNodeSchema.safeParse({ type: "html", value: "<marquee>x</marquee>" }).success).toBe(false);
    expect(SafeNodeSchema.safeParse({ type: "script", value: "alert(1)" }).success).toBe(false);
    expect(SafeNodeSchema.safeParse({ type: "text", value: "ok", extra: true }).success).toBe(false);
  });

  it("plain text may contain markup-looking characters; rendering escapes them", () => {
    expect(SafeNodeSchema.safeParse({ type: "text", value: "<script>alert(1)</script>" }).success).toBe(true);
  });
});
