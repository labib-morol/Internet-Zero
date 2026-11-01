import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Claim, EvidenceItem } from "@iz/schema";
import type { WireRuntimeState } from "@iz/ui";
import { createIzClient, setIzClientForTests, useSessionStore } from "@iz/ui";
import {
  BOARD_STORAGE_KEY,
  BoardWindow,
  layeredLayout,
  resetBoardPositionsForTests,
  useBoardPositions,
} from "../src/board/index.js";

/**
 * Board tests (§11.2): nodes/edges from wire state, keyboard link creation
 * (L → arrows → Enter → relation+confidence modal), unlink via Delete and the
 * link list, auto-layout determinism, details pane, and position persistence
 * (iz.board.v1 — presentation state only).
 */

function evidence(partial: Partial<EvidenceItem> & { id: string }): EvidenceItem {
  return {
    artifactId: "a.artifact",
    collectedBy: "user-1",
    collectedAt: "2026-11-02T10:00:00.000Z",
    provenance: { host: "archive.pinecone.pcp", path: "/docs/memo", service: "archive" },
    archived: false,
    ...partial,
  };
}

function claim(partial: Partial<Claim> & { id: string }): Claim {
  return {
    text: "A claim.",
    createdBy: "user-1",
    createdAt: "2026-11-02T10:05:00.000Z",
    private: false,
    ...partial,
  };
}

function wireState(over: Partial<WireRuntimeState> = {}): WireRuntimeState {
  return {
    teamId: "team-1",
    worldId: "w.tutorial",
    bundleHash: "hash-1",
    startedAt: "2026-11-02T09:00:00.000Z",
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
    ...over,
  };
}

/** jsdom has no ResizeObserver and reports 0×0 for every element, so xyflow
 *  never marks nodes measured and skips edges. The stub gives observed
 *  elements plausible box properties, then fires the callback once. */
class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    for (const [prop, value] of [
      ["offsetWidth", 200],
      ["offsetHeight", 90],
      ["clientWidth", 200],
      ["clientHeight", 90],
    ] as const) {
      Object.defineProperty(target, prop, { value, configurable: true });
    }
    const entry = {
      target,
      contentRect: { x: 0, y: 0, width: 200, height: 90, top: 0, left: 0, right: 200, bottom: 90 },
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {}
}

/** jsdom lacks DOMMatrixReadOnly; xyflow reads the zoom (m22) out of the
 *  pane's transform string. */
class DOMMatrixReadOnlyStub {
  m22 = 1;
  constructor(_init?: string | number[]) {}
}

type Route = (url: string, init: RequestInit | undefined) => { status: number; body: unknown } | undefined;

function installFetch(routes: Route[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const route of routes) {
      const response = route(url, init);
      if (response !== undefined) {
        return new Response(JSON.stringify(response.body), {
          status: response.status,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ error: "unrouted" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  setIzClientForTests(createIzClient({ getToken: () => useSessionStore.getState().session?.token }));
  return fetchMock;
}

function seedSession(state: WireRuntimeState): void {
  useSessionStore.setState({
    screen: "shell",
    status: "ready",
    session: { teamId: state.teamId, userId: "user-1", token: "tok-1" },
    state,
    connection: "online",
  });
}

function board(): HTMLElement {
  return screen.getByRole("application", { name: /Evidence board/ });
}

function nodeById(id: string): HTMLElement | null {
  return document.querySelector(`[data-id="${id}"]`);
}

/** jsdom normalizes transforms ("translate(0px,0px)"); strip spaces for stable asserts. */
function transformOf(id: string): string {
  return (nodeById(id)?.style.transform ?? "").replace(/\s+/g, "");
}

function storedPositions(): Record<string, { x: number; y: number }> {
  const raw = JSON.parse(localStorage.getItem(BOARD_STORAGE_KEY) ?? "{}") as {
    state?: { positions?: Record<string, { x: number; y: number }> };
  };
  return raw.state?.positions ?? {};
}

function submittedAction(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const submit = fetchMock.mock.calls.find(
    ([url, init]) => String(url).endsWith("/api/actions") && init?.method === "POST"
  );
  expect(submit).toBeDefined();
  return JSON.parse(String(submit?.[1]?.body)).action;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("DOMMatrixReadOnly", DOMMatrixReadOnlyStub);
  // jsdom SVG elements have no geometry API; xyflow measures edge labels.
  const svgProto = SVGElement.prototype as unknown as Record<string, unknown>;
  if (typeof SVGElement !== "undefined" && svgProto.getBBox === undefined) {
    Object.defineProperty(svgProto, "getBBox", {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 80, height: 16 }),
    });
  }
  resetBoardPositionsForTests();
  localStorage.clear();
  useSessionStore.getState().reset();
});

afterEach(() => {
  cleanup();
  setIzClientForTests(undefined);
  vi.unstubAllGlobals();
});

describe("evidence board", () => {
  it("renders evidence as document cards, claims as notes, and edges with relation + confidence", async () => {
    seedSession(
      wireState({
        evidence: { "e.1": evidence({ id: "e.1", artifactId: "a.memo" }) },
        claims: { "c.1": claim({ id: "c.1", text: "The memo predates the layoffs." }) },
        links: {
          "l.1": {
            id: "l.1",
            from: "e.1",
            to: "c.1",
            relation: "supports",
            confidence: 2,
            createdBy: "user-1",
            createdAt: "2026-11-02T10:06:00.000Z",
          },
        },
      })
    );
    render(<BoardWindow />);

    const docNode = await screen.findByTestId("board-node-e.1");
    expect(docNode).toHaveTextContent("archive.pinecone.pcp/docs/memo");
    expect(docNode).toHaveTextContent("Evidence");
    expect(docNode).toHaveTextContent("archive"); // service chip

    const noteNode = await screen.findByTestId("board-node-c.1");
    expect(noteNode).toHaveTextContent("The memo predates the layoffs.");
    expect(noteNode).toHaveTextContent("Claim");

    // Edge label: relation + confidence dots (2 of 3).
    await waitFor(() => expect(screen.getByText(/supports ●●○/)).toBeInTheDocument());
    // Keyboard-accessible link list mirrors the canvas.
    expect(screen.getByRole("list", { name: "Links on this board" })).toHaveTextContent("supports");
  });

  it("hides archived evidence from the board", async () => {
    seedSession(
      wireState({
        evidence: { "e.gone": evidence({ id: "e.gone", archived: true }) },
        claims: { "c.1": claim({ id: "c.1" }) },
      })
    );
    render(<BoardWindow />);
    await screen.findByTestId("board-node-c.1");
    expect(screen.queryByTestId("board-node-e.gone")).not.toBeInTheDocument();
  });

  it("creates a link by keyboard: select, L, arrows, Enter, then relation + confidence", async () => {
    const fetchMock = installFetch([
      (url, init) => {
        if (url.endsWith("/api/actions") && init?.method === "POST") {
          return {
            status: 200,
            body: {
              events: [
                {
                  type: "LinkCreated",
                  linkId: "l.new",
                  from: "e.1",
                  to: "c.1",
                  relation: "contradicts",
                  confidence: 3,
                  at: "2026-11-02T10:20:00.000Z",
                  by: "user-1",
                },
              ],
            },
          };
        }
        return undefined;
      },
    ]);
    seedSession(
      wireState({
        evidence: { "e.1": evidence({ id: "e.1", artifactId: "a.memo" }) },
        claims: { "c.1": claim({ id: "c.1", text: "The memo predates the layoffs." }) },
      })
    );
    render(<BoardWindow />);
    await screen.findByTestId("board-node-e.1");

    // Arrow keys move the selection (evidence comes first in board order).
    fireEvent.keyDown(board(), { key: "ArrowDown" });
    await waitFor(() => expect(nodeById("e.1")?.className).toContain("selected"));

    // L starts link mode; the banner names the source.
    fireEvent.keyDown(board(), { key: "l" });
    expect(screen.getByRole("status")).toHaveTextContent(/Linking from/);

    // Arrow walks the target cursor, Enter confirms the pair.
    fireEvent.keyDown(board(), { key: "ArrowDown" });
    fireEvent.keyDown(board(), { key: "Enter" });

    const dialog = await screen.findByRole("dialog", { name: "Create a link" });
    expect(dialog).toHaveTextContent("archive.pinecone.pcp/docs/memo");
    fireEvent.click(within(dialog).getByLabelText(/^contradicts/));
    fireEvent.click(within(dialog).getByLabelText(/^3/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create link" }));

    // The dispatch carries the exact link payload.
    await waitFor(() => {
      expect(submittedAction(fetchMock)).toEqual({
        type: "link",
        from: "e.1",
        to: "c.1",
        relation: "contradicts",
        confidence: 3,
      });
    });
    // The merged LinkCreated event puts the edge on the board and closes the modal.
    await waitFor(() => expect(screen.getByText(/contradicts ●●●/)).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("removes a link with Delete on a selected edge", async () => {
    const fetchMock = installFetch([
      (url, init) => {
        if (url.endsWith("/api/actions") && init?.method === "POST") {
          return {
            status: 200,
            body: {
              events: [
                { type: "LinkRemoved", linkId: "l.1", at: "2026-11-02T10:30:00.000Z", by: "user-1" },
              ],
            },
          };
        }
        return undefined;
      },
    ]);
    seedSession(
      wireState({
        evidence: { "e.1": evidence({ id: "e.1", artifactId: "a.memo" }) },
        claims: { "c.1": claim({ id: "c.1", text: "The memo predates the layoffs." }) },
        links: {
          "l.1": {
            id: "l.1",
            from: "e.1",
            to: "c.1",
            relation: "supports",
            confidence: 1,
            createdBy: "user-1",
            createdAt: "2026-11-02T10:06:00.000Z",
          },
        },
      })
    );
    render(<BoardWindow />);
    await screen.findByTestId("board-node-e.1");

    const edge = await waitFor(() => {
      const el = document.querySelector(`.react-flow__edge[data-id="l.1"]`);
      expect(el).not.toBeNull();
      return el as Element;
    });
    fireEvent.click(edge);
    fireEvent.keyDown(board(), { key: "Delete" });

    await waitFor(() => expect(screen.queryByText(/supports ●○○/)).not.toBeInTheDocument());
    expect(submittedAction(fetchMock)).toEqual({ type: "unlink", linkId: "l.1" });
  });

  it("removes a link from the keyboard-accessible link list", async () => {
    const fetchMock = installFetch([
      (url, init) => {
        if (url.endsWith("/api/actions") && init?.method === "POST") {
          return {
            status: 200,
            body: {
              events: [
                { type: "LinkRemoved", linkId: "l.1", at: "2026-11-02T10:30:00.000Z", by: "user-1" },
              ],
            },
          };
        }
        return undefined;
      },
    ]);
    seedSession(
      wireState({
        evidence: { "e.1": evidence({ id: "e.1", artifactId: "a.memo" }) },
        claims: { "c.1": claim({ id: "c.1", text: "The memo predates the layoffs." }) },
        links: {
          "l.1": {
            id: "l.1",
            from: "e.1",
            to: "c.1",
            relation: "supports",
            confidence: 3,
            createdBy: "user-1",
            createdAt: "2026-11-02T10:06:00.000Z",
          },
        },
      })
    );
    render(<BoardWindow />);
    await screen.findByTestId("board-node-e.1");

    fireEvent.click(screen.getByRole("button", { name: /Remove link/ }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Remove link/ })).not.toBeInTheDocument()
    );
    expect(submittedAction(fetchMock)).toEqual({ type: "unlink", linkId: "l.1" });
  });

  it("auto-layout arranges nodes in layers following link direction, deterministically", async () => {
    seedSession(
      wireState({
        evidence: {
          "e.1": evidence({ id: "e.1", artifactId: "a.memo" }),
          "e.2": evidence({
            id: "e.2",
            artifactId: "a.mail",
            provenance: { host: "mail.pinecone.pcp", path: "/inbox", service: "mail" },
          }),
        },
        claims: { "c.1": claim({ id: "c.1" }) },
        links: {
          "l.1": {
            id: "l.1",
            from: "e.1",
            to: "c.1",
            relation: "supports",
            confidence: 2,
            createdBy: "user-1",
            createdAt: "2026-11-02T10:06:00.000Z",
          },
        },
      })
    );
    render(<BoardWindow />);
    await screen.findByTestId("board-node-e.1");

    fireEvent.click(screen.getByRole("button", { name: "Auto-layout" }));

    await waitFor(() => {
      expect(transformOf("e.1")).toBe("translate(0px,0px)");
      expect(transformOf("e.2")).toBe("translate(0px,150px)");
      expect(transformOf("c.1")).toBe("translate(280px,0px)");
    });
    // Layout positions are presentation state: persisted locally.
    expect(storedPositions()["c.1"]?.x).toBe(280);
  });

  it("persists node positions to localStorage under iz.board.v1 and rehydrates them", async () => {
    localStorage.setItem(
      BOARD_STORAGE_KEY,
      JSON.stringify({ state: { positions: { "e.1": { x: 123, y: 45 } } }, version: 0 })
    );
    await useBoardPositions.persist.rehydrate();
    seedSession(
      wireState({
        evidence: { "e.1": evidence({ id: "e.1", artifactId: "a.memo" }) },
        claims: { "c.1": claim({ id: "c.1" }) },
      })
    );
    render(<BoardWindow />);
    await screen.findByTestId("board-node-e.1");

    // Hydrated positions drive the node transform on first layout.
    expect(transformOf("e.1")).toBe("translate(123px,45px)");

    // The store (used by onNodeDragStop) writes through to localStorage.
    useBoardPositions.getState().setPosition("c.1", { x: 500, y: 60 });
    expect(storedPositions()["c.1"]).toEqual({ x: 500, y: 60 });
  });

  it("Enter opens the item's details pane and calls the integrator callback", async () => {
    const onOpenItem = vi.fn();
    seedSession(
      wireState({
        evidence: { "e.1": evidence({ id: "e.1", artifactId: "a.memo" }) },
      })
    );
    render(<BoardWindow onOpenItem={onOpenItem} />);
    await screen.findByTestId("board-node-e.1");

    fireEvent.keyDown(board(), { key: "ArrowDown" });
    await waitFor(() => expect(nodeById("e.1")?.className).toContain("selected"));
    fireEvent.keyDown(board(), { key: "Enter" });

    expect(onOpenItem).toHaveBeenCalledWith({ id: "e.1", kind: "evidence" });
    expect(screen.getByText(/artifact a\.memo/)).toBeInTheDocument();
  });

  it("layeredLayout is deterministic and pushes conclusions right of their sources", () => {
    const layout = layeredLayout(
      ["a", "b", "c", "d"],
      [
        { from: "a", to: "c" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
      ]
    );
    expect(layout["a"]).toEqual({ x: 0, y: 0 });
    expect(layout["b"]).toEqual({ x: 0, y: 150 });
    expect(layout["c"]).toEqual({ x: 280, y: 0 });
    expect(layout["d"]).toEqual({ x: 560, y: 0 });
    // Same input, same output.
    expect(layeredLayout(["x", "y"], [{ from: "y", to: "x" }])).toEqual(
      layeredLayout(["x", "y"], [{ from: "y", to: "x" }])
    );
  });
});
