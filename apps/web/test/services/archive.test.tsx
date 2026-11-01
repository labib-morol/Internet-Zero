import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ArchiveDocumentView, ArchiveSearchView, SafeNode } from "@iz/schema";
import { useBrowserStore } from "../../src/browser/store.js";
import { ArchivePage } from "../../src/services/archive/ArchiveViews.js";

function doc(...children: SafeNode[]): SafeNode {
  return { type: "root", children };
}
function p(text: string): SafeNode {
  return { type: "paragraph", children: [{ type: "text", value: text }] };
}

beforeEach(() => {
  useBrowserStore.setState({ entries: [], index: -1, bookmarks: [], load: "idle", view: undefined, collectibles: [], error: undefined, visitedHosts: [] });
});

afterEach(cleanup);

describe("ArchivePage: search", () => {
  const search: ArchiveSearchView = {
    view: "archive-search",
    query: "printer",
    results: [
      {
        artifactId: "a.doc1",
        title: "Printer rotation memo",
        type: "report",
        date: "2026-10-03T00:00:00.000Z",
        snippet: "…the admin passphrase rotates quarterly…",
      },
    ],
  };

  it("renders the query, results with type and snippet", () => {
    render(<ArchivePage view={search} host="archive.pinecone.pcp" />);
    expect(screen.getByText(/Results for/)).toBeInTheDocument();
    expect(screen.getAllByText("Printer rotation memo").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("…the admin passphrase rotates quarterly…")).toBeInTheDocument();
    expect(screen.getByText("report")).toBeInTheDocument();
  });

  it("navigates to the encoded search route on submit", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    useBrowserStore.setState({ navigate });
    render(<ArchivePage view={search} host="archive.pinecone.pcp" />);
    const input = screen.getByLabelText("Archive search query");
    fireEvent.change(input, { target: { value: "badge codes" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("archive.pinecone.pcp", "/search/badge%20codes"));
  });

  it("renders the empty landing variant without a results line", () => {
    render(<ArchivePage view={{ view: "archive-search", query: "", results: [] }} host="archive.pinecone.pcp" />);
    expect(screen.queryByText(/Results for/)).not.toBeInTheDocument();
  });
});

describe("ArchivePage: document", () => {
  const document: ArchiveDocumentView = {
    view: "archive-document",
    artifactId: "a.doc1",
    doc: {
      id: "a.doc1",
      title: "Printer rotation memo",
      type: "report",
      date: "2026-10-03T00:00:00.000Z",
      source: "facilities drive",
      ast: doc(
        p("The passphrase is "),
        { type: "redaction", text: "biscuit2009", removable: true },
        p(". Non-removable: "),
        { type: "redaction", text: "classified", removable: false }
      ),
      meta: { "exif:make": "PineCam", pages: "4" },
      assets: [{ assetId: "as.scan", label: "scan of the memo" }],
      removableRedactions: 1,
    },
  };

  it("renders body, type badge, source, and hides redaction text until inspected", () => {
    render(<ArchivePage view={document} host="archive.pinecone.pcp" />);
    expect(screen.getAllByText("Printer rotation memo").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/source facilities drive/)).toBeInTheDocument();
    expect(screen.queryByText("biscuit2009")).not.toBeInTheDocument();
    // Fixed redactions never reveal, even when inspecting.
    expect(screen.queryByText("classified")).not.toBeInTheDocument();
  });

  it("reveals removable redactions via Inspect layers", () => {
    render(<ArchivePage view={document} host="archive.pinecone.pcp" />);
    fireEvent.click(screen.getByRole("button", { name: /Inspect layers/ }));
    expect(screen.getByText("biscuit2009")).toBeInTheDocument();
    expect(screen.queryByText("classified")).not.toBeInTheDocument();
  });

  it("offers the metadata inspector and asset placeholder boxes", () => {
    const { container } = render(<ArchivePage view={document} host="archive.pinecone.pcp" />);
    const inspector = screen.getByText("Metadata inspector");
    expect(inspector).toBeInTheDocument();
    fireEvent.click(inspector);
    expect(screen.getByText("exif:make")).toBeInTheDocument();
    expect(screen.getByText("PineCam")).toBeInTheDocument();
    expect(container.querySelectorAll(".iz-assetbox").length).toBe(1);
    expect(container.textContent).toContain("asset unavailable in this build");
  });

  it("omits the inspect tool when there is nothing removable", () => {
    const clean: ArchiveDocumentView = {
      ...document,
      doc: { ...document.doc, removableRedactions: 0, ast: doc(p("nothing hidden")) },
    };
    render(<ArchivePage view={clean} host="archive.pinecone.pcp" />);
    expect(screen.queryByRole("button", { name: /Inspect layers/ })).not.toBeInTheDocument();
  });
});
