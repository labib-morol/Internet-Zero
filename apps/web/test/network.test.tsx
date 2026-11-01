import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { rangeFragment, selectionRangeIn } from "../src/browser/selection.js";
import { NetworkDirectory } from "../src/network/NetworkDirectory.js";
import { useBrowserStore } from "../src/browser/store.js";
import { useSessionStore } from "@iz/ui";

afterEach(cleanup);

function selectText(node: Node, start = 0, end = node.textContent?.length ?? 0): Selection {
  const selection = window.getSelection()!;
  const range = document.createRange();
  const textNode = node.textContent !== null && node.nodeType !== Node.TEXT_NODE ? node.firstChild! : node;
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe("selection → fragment (select-then-press-C)", () => {
  it("computes stable character offsets across paragraphs", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>alpha beta</p><p>gamma delta</p>";
    document.body.appendChild(container);
    const second = container.querySelectorAll("p")[1]!;
    const selection = selectText(second, 0, 5); // "gamma"
    const range = selectionRangeIn(container, selection);
    expect(range).toEqual({ start: 10, end: 15 }); // after "alpha beta" (10 chars)
    const fragment = rangeFragment(range!);
    expect(fragment).toEqual({ kind: "range", start: 10, end: 15 });
    container.remove();
  });

  it("returns undefined for collapsed or out-of-container selections", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>text</p>";
    document.body.appendChild(container);
    const p = container.querySelector("p")!;
    expect(selectionRangeIn(container, selectText(p, 2, 2))).toBeUndefined(); // collapsed
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    expect(selectionRangeIn(container, selectText(outside))).toBeUndefined();
    container.remove();
    outside.remove();
  });
});

describe("network directory host derivation", () => {
  it("lists the world host table plus visited hosts, with service and title", () => {
    useSessionStore.setState({
      world: {
        worldId: "w.tutorial",
        title: "Lost and Found",
        summary: "s",
        version: "1.0.0",
        bundleHash: "h",
        entry: "forge.pinecone.pcp/pinecone/office-scripts",
        hosts: [
          { host: "forge.pinecone.pcp", service: "forge", title: "GIT//FORGE" },
          { host: "mail.pinecone.pcp", service: "mail", title: "DEADLETTER" },
          { host: "printer.pinecone.pcp", service: "terminal", title: "NODE TERMINAL" },
        ],
      },
      state: {
        teamId: "t",
        worldId: "w.tutorial",
        bundleHash: "h",
        startedAt: "2026-11-02T10:00:00.000Z",
        solvedGates: {},
        unlocked: [],
        evidence: {},
        claims: {},
        links: {},
        hintsUsed: {},
        reportGroupsAccepted: {},
        firedEvents: [],
        overlayFs: {},
        readPaths: {},
        attempts: {},
        score: 0,
      },
    });
    useBrowserStore.setState({ visitedHosts: ["extra.pinecone.pcp"] });

    render(<NetworkDirectory />);
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("GIT//FORGE");
    expect(table).toHaveTextContent("forge.pinecone.pcp");
    expect(table).toHaveTextContent("DEADLETTER");
    expect(table).toHaveTextContent("NODE TERMINAL");
    expect(table).toHaveTextContent("start page");
    expect(table).toHaveTextContent("extra.pinecone.pcp"); // visited fallback
  });
});
