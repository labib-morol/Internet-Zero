import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ViewModel } from "@iz/schema";
import {
  currentEntry,
  formatAddress,
  parseAddress,
  setViewFetchForTests,
  useBrowserStore,
} from "../src/browser/store.js";
import { ViewRenderer } from "../src/browser/ViewRenderer.js";
import { BrowserWindow } from "../src/browser/BrowserWindow.js";

beforeEach(() => {
  useBrowserStore.setState({
    entries: [],
    index: -1,
    bookmarks: [],
    load: "idle",
    view: undefined,
    collectibles: [],
    error: undefined,
    visitedHosts: [],
  });
});

afterEach(cleanup);

describe("parseAddress", () => {
  it("parses host/path and normalizes the host", () => {
    expect(parseAddress("Forge.Pinecone.pcp/pinecone/office-scripts")).toEqual({
      host: "forge.pinecone.pcp",
      path: "/pinecone/office-scripts",
    });
    expect(parseAddress("http://mail.pinecone.pcp")).toEqual({ host: "mail.pinecone.pcp", path: "/" });
    expect(parseAddress("host/path/")).toEqual({ host: "host", path: "/path/" });
    expect(parseAddress("")).toBeUndefined();
    expect(parseAddress("not a host with spaces")).toBeUndefined(); // whitespace is not a host
  });

  it("formats the address without a bare root slash", () => {
    expect(formatAddress({ host: "a.b", path: "/" })).toBe("a.b");
    expect(formatAddress({ host: "a.b", path: "/x/y" })).toBe("a.b/x/y");
  });
});

describe("browser store history", () => {
  it("pushes entries, truncates forward history on a new navigation and serves views", async () => {
    const viewA: ViewModel = { notFound: true, host: "a.host", path: "/" };
    const viewB: ViewModel = { view: "terminal", host: "t.host", cwd: "/", motd: null, lines: [], passphrasePrompt: false };
    let counter = 0;
    setViewFetchForTests(async (host) => {
      counter += 1;
      return { view: host === "a.host" ? viewA : viewB, collectibles: [] };
    });
    const { navigate, back, forward } = useBrowserStore.getState();
    await navigate("a.host", "/");
    await navigate("b.host", "/x");
    let state = useBrowserStore.getState();
    expect(state.entries.map((e) => formatAddress(e))).toEqual(["a.host", "b.host/x"]);
    expect(state.visitedHosts).toEqual(["a.host", "b.host"]);

    await back();
    state = useBrowserStore.getState();
    expect(state.index).toBe(0);
    await waitFor(() => expect(state.load).toBe("ready"));
    await forward();
    state = useBrowserStore.getState();
    expect(state.index).toBe(1);

    await navigate("c.host", "/");
    state = useBrowserStore.getState();
    expect(state.entries.map((e) => e.host)).toEqual(["a.host", "b.host", "c.host"]); // forward truncated
    expect(counter).toBeGreaterThanOrEqual(3);
    setViewFetchForTests(undefined);
  });

  it("toggles bookmarks", async () => {
    setViewFetchForTests(async () => ({
      view: { notFound: true, host: "x", path: "/" },
      collectibles: [],
    }));
    const { navigate, toggleBookmark } = useBrowserStore.getState();
    await navigate("x.host", "/page");
    toggleBookmark();
    expect(useBrowserStore.getState().bookmarks).toEqual([{ host: "x.host", path: "/page" }]);
    toggleBookmark();
    expect(useBrowserStore.getState().bookmarks).toEqual([]);
    setViewFetchForTests(undefined);
  });
});

describe("view rendering", () => {
  it("renders the in-fiction host-not-found page for notFound views", () => {
    render(<ViewRenderer view={{ notFound: true, host: "ghost.host", path: "/x" }} collectibles={[]} host="ghost.host" onCollect={() => undefined} />);
    expect(screen.getByRole("heading", { name: "Host not found" })).toBeInTheDocument();
    expect(screen.getByText(/ghost.host\/x/)).toBeInTheDocument();
  });

  it("renders AST-bearing document views through the SafeAst renderer", () => {
    render(
      <ViewRenderer
        view={{
          view: "archive-document",
          artifactId: "a.doc",
          doc: {
            id: "doc-1",
            title: "Incident report",
            type: "report",
            date: "2026-10-01T00:00:00.000Z",
            source: "internal",
            ast: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "Body text" }] }] },
            meta: { author: "R. Vance" },
            assets: [],
            removableRedactions: 0,
          },
        }}
        collectibles={[]}
        host="archive.host"
        onCollect={() => undefined}
      />
    );
    expect(screen.getByRole("heading", { name: "Incident report" })).toBeInTheDocument();
    expect(screen.getByText("Body text")).toBeInTheDocument();
    expect(screen.getByText("Metadata inspector")).toBeInTheDocument();
  });

  it("offers Collect buttons for collectibles and never navigates the real browser", async () => {
    const onCollect = vi.fn();
    const before = window.location.href;
    render(
      <ViewRenderer
        view={{
          view: "repo-home",
          artifactId: "a.readme",
          owner: "kestrel",
          name: "relay-core",
          description: "The relay daemon",
          defaultBranch: "main",
          readmeAst: {
            type: "root",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "Read the " }] },
              { type: "link", url: "docs.host/manual", children: [{ type: "text", value: "manual" }] },
            ],
          },
          recentCommits: [{ sha: "a".repeat(40), date: "2026-10-01T00:00:00.000Z", message: "init", authorName: "R. Vance" }],
          openIssues: [{ number: 212, title: "Relay drops frames" }],
        }}
        collectibles={[{ artifactId: "a.readme", label: "README" }]}
        host="forge.host"
        onCollect={onCollect}
      />
    );
    // M1 task 4+: the per-service masthead Collect button (aria-label carries the collectible label).
    const collect = screen.getByRole("button", { name: "Collect evidence: README" });
    fireEvent.click(collect);
    expect(onCollect).toHaveBeenCalledWith("a.readme", "README");

    // In-game link: dispatches through the browser store, never window.location.
    setViewFetchForTests(async () => ({
      view: { notFound: true, host: "docs.host", path: "/manual" },
      collectibles: [],
    }));
    fireEvent.click(screen.getByText("manual"));
    await waitFor(() => {
      const state = useBrowserStore.getState();
      expect(state.entries.some((e) => e.host === "docs.host")).toBe(true);
    });
    expect(window.location.href).toBe(before);
    setViewFetchForTests(undefined);
  });
});

describe("BrowserWindow", () => {
  it("renders empty state, then the entry view after navigation; keyboard C collects a selection", async () => {
    setViewFetchForTests(async () => ({
      view: {
        view: "repo-home",
        artifactId: "a.readme",
        owner: "o",
        name: "r",
        description: "d",
        defaultBranch: "main",
        readmeAst: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "Collectible words here" }] }] },
        recentCommits: [],
        openIssues: [],
      },
      collectibles: [],
    }));
    const collectSelection = vi.fn().mockResolvedValue(true);
    useBrowserStore.setState({
      entries: [{ host: "forge.host", path: "/o/r" }],
      index: 0,
      load: "ready",
      view: {
        view: "repo-home",
        artifactId: "a.readme",
        owner: "o",
        name: "r",
        description: "d",
        defaultBranch: "main",
        readmeAst: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "Collectible words here" }] }] },
        recentCommits: [],
        openIssues: [],
      },
      collectibles: [],
    });
    useBrowserStore.setState({ collectSelection });

    render(<BrowserWindow />);
    expect(await screen.findByText("Collectible words here")).toBeInTheDocument();
    expect(screen.getByLabelText("In-game address")).toHaveValue("forge.host/o/r");

    // Select text inside the page, press C → collectSelection called with a range.
    const content = screen.getByLabelText(/Page content/);
    const paragraph = screen.getByText("Collectible words here");
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.keyDown(content, { key: "c" });
    await waitFor(() => expect(collectSelection).toHaveBeenCalled());
    const fragment = collectSelection.mock.calls[0]?.[0] as { kind: string; start: number; end: number };
    expect(fragment.kind).toBe("range");
    expect(fragment.end).toBeGreaterThan(fragment.start);

    // Control keys do not trigger collection.
    collectSelection.mockClear();
    fireEvent.keyDown(content, { key: "c", ctrlKey: true });
    expect(collectSelection).not.toHaveBeenCalled();
    setViewFetchForTests(undefined);
  });

  it("exposes the current entry helper", async () => {
    setViewFetchForTests(async () => ({ view: { notFound: true, host: "a", path: "/" }, collectibles: [] }));
    await useBrowserStore.getState().navigate("a.host", "/b");
    expect(currentEntry(useBrowserStore.getState())).toEqual({ host: "a.host", path: "/b" });
    setViewFetchForTests(undefined);
  });
});
