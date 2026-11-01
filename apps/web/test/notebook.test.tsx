import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Claim, EvidenceItem } from "@iz/schema";
import type { WireRuntimeState } from "@iz/ui";
import { createIzClient, setIzClientForTests, useSessionStore } from "@iz/ui";
import { NotebookWindow, resetTitleCacheForTests } from "../src/notebook/index.js";

/**
 * Notebook tests (§11.2): rendering from a constructed wire state, filters +
 * search, the title cache (GET /api/view only, honest fallbacks), archive
 * dispatch, open-in-browser callback, private notes tab, and live collection.
 */

const TEXT_NODE = { type: "text", value: "" } as const;

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
  // The session store keeps a module-level client: rebind it to THIS test's
  // fetch stub before any dispatch.
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

beforeEach(() => {
  resetTitleCacheForTests();
  localStorage.clear();
  useSessionStore.getState().reset();
});

afterEach(() => {
  cleanup();
  setIzClientForTests(undefined);
  vi.unstubAllGlobals();
});

describe("notebook", () => {
  it("renders evidence as document cards and claims as notes, hides archived, counts them", () => {
    seedSession(
      wireState({
        evidence: {
          "e.1": evidence({ id: "e.1", artifactId: "a.memo" }),
          "e.old": evidence({
            id: "e.old",
            artifactId: "a.old",
            archived: true,
            provenance: { host: "mail.pinecone.pcp", path: "/inbox", service: "mail" },
          }),
        },
        claims: {
          "c.1": claim({ id: "c.1", text: "The memo predates the layoffs." }),
          "c.2": claim({ id: "c.2", text: "A private thought.", private: true }),
        },
      })
    );
    render(<NotebookWindow />);

    // Document-card title falls back to host+path (no view fetch ran here);
    // the same string also appears in the provenance chip.
    expect(screen.getAllByText("archive.pinecone.pcp/docs/memo").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/artifact/)).toHaveTextContent("a.memo");
    expect(screen.getByText("The memo predates the layoffs.")).toBeInTheDocument();
    // Archived evidence stays in the log but is hidden; the count is shown.
    expect(screen.queryByText("mail.pinecone.pcp/inbox")).not.toBeInTheDocument();
    expect(screen.getByText(/1 archived/)).toBeInTheDocument();
    // Private claims belong to the private tab, not the case list.
    expect(screen.queryByText("A private thought.")).not.toBeInTheDocument();
  });

  it("resolves titles via GET /api/view for visible pages and de-dupes per page", async () => {
    const fetchMock = installFetch([
      (url) => {
        if (url.includes("/api/view") && url.includes("archive.pinecone.pcp")) {
          return {
            status: 200,
            body: {
              view: {
                view: "archive-document",
                artifactId: "a.memo",
                doc: {
                  id: "a.memo",
                  title: "The Pinecone Memo",
                  type: "report",
                  date: "2026-11-01T00:00:00.000Z",
                  source: "",
                  ast: TEXT_NODE,
                  meta: {},
                  assets: [],
                  removableRedactions: 0,
                },
              },
              collectibles: [],
            },
          };
        }
        return undefined;
      },
    ]);
    seedSession(
      wireState({
        evidence: {
          // Two items collected on the same page; only one has a resolvable title.
          "e.1": evidence({ id: "e.1", artifactId: "a.memo" }),
          "e.2": evidence({
            id: "e.2",
            artifactId: "a.selection",
            collectedAt: "2026-11-02T10:01:00.000Z",
          }),
        },
      })
    );
    render(<NotebookWindow />);

    await waitFor(() => expect(screen.getByText("The Pinecone Memo")).toBeInTheDocument());
    // The sibling on the same page keeps the host+path fallback...
    expect(screen.getAllByText("archive.pinecone.pcp/docs/memo").length).toBeGreaterThanOrEqual(1);
    // ...and both were served by ONE page fetch (cache is per (team, page)).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/view");
  });

  it("falls back to host+path when the page is not visible to the team", async () => {
    installFetch([]); // everything 404s: locked or unknown pages stay unnamed
    seedSession(
      wireState({
        evidence: { "e.1": evidence({ id: "e.1", artifactId: "a.secret" }) },
      })
    );
    render(<NotebookWindow />);
    await waitFor(() =>
      expect(screen.getAllByText("archive.pinecone.pcp/docs/memo").length).toBeGreaterThanOrEqual(1)
    );
    expect(screen.queryByText("The secret document")).not.toBeInTheDocument();
  });

  it("filters by type, host and search text", () => {
    seedSession(
      wireState({
        evidence: {
          "e.1": evidence({ id: "e.1", artifactId: "a.memo" }),
          "e.2": evidence({
            id: "e.2",
            artifactId: "a.mail",
            provenance: { host: "mail.pinecone.pcp", path: "/inbox/launch-day", service: "mail" },
          }),
        },
        claims: { "c.1": claim({ id: "c.1", text: "Launch day was moved." }) },
      })
    );
    render(<NotebookWindow />);

    // Type filter: evidence only.
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    expect(screen.getAllByText("mail.pinecone.pcp/inbox/launch-day").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Launch day was moved.")).not.toBeInTheDocument();

    // Back to all, then host filter.
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByLabelText("Filter by host"), {
      target: { value: "mail.pinecone.pcp" },
    });
    expect(screen.getAllByText("mail.pinecone.pcp/inbox/launch-day").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("archive.pinecone.pcp/docs/memo")).not.toBeInTheDocument();

    // Search matches evidence source paths but not unrelated claims.
    fireEvent.change(screen.getByLabelText("Filter by host"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Search the notebook"), { target: { value: "inbox" } });
    expect(screen.getAllByText("mail.pinecone.pcp/inbox/launch-day").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Launch day was moved.")).not.toBeInTheDocument();

    // Search matches claim text too.
    fireEvent.change(screen.getByLabelText("Search the notebook"), { target: { value: "moved" } });
    expect(screen.getByText("Launch day was moved.")).toBeInTheDocument();
    expect(screen.queryByText("mail.pinecone.pcp/inbox/launch-day")).not.toBeInTheDocument();

    // No matches at all: an honest empty state.
    fireEvent.change(screen.getByLabelText("Search the notebook"), { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches the current filters.")).toBeInTheDocument();
  });

  it("archives evidence through dispatch and shows the updated count", async () => {
    const fetchMock = installFetch([
      (url, init) => {
        if (url.endsWith("/api/actions") && init?.method === "POST") {
          return {
            status: 200,
            body: {
              events: [
                {
                  type: "EvidenceArchived",
                  evidenceId: "e.1",
                  at: "2026-11-02T10:10:00.000Z",
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
      })
    );
    render(<NotebookWindow />);
    expect(screen.getAllByText("archive.pinecone.pcp/docs/memo").length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(screen.queryByText("archive.pinecone.pcp/docs/memo")).not.toBeInTheDocument()
    );
    expect(screen.getByText(/1 archived/)).toBeInTheDocument();
    expect(screen.getByText(/0 shown/)).toBeInTheDocument();
    const submit = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/api/actions") && init?.method === "POST"
    );
    expect(submit).toBeDefined();
    expect(JSON.parse(String(submit?.[1]?.body)).action).toEqual({
      type: "archiveEvidence",
      evidenceId: "e.1",
    });
  });

  it("calls the integrator's open-in-browser callback with the item's provenance", () => {
    seedSession(
      wireState({
        evidence: { "e.1": evidence({ id: "e.1", artifactId: "a.memo" }) },
      })
    );
    const onOpenInBrowser = vi.fn();
    render(<NotebookWindow onOpenInBrowser={onOpenInBrowser} />);

    fireEvent.click(screen.getByRole("button", { name: "Open source" }));
    expect(onOpenInBrowser).toHaveBeenCalledWith({
      host: "archive.pinecone.pcp",
      path: "/docs/memo",
      artifactId: "a.memo",
    });
  });

  it("shows private claims in the private notes tab with an honest sync note", async () => {
    seedSession(
      wireState({
        claims: {
          "c.1": claim({ id: "c.1", text: "Shared note." }),
        },
      })
    );
    render(<NotebookWindow />);

    // Nothing private yet: say so instead of pretending.
    fireEvent.click(screen.getByRole("tab", { name: "Private notes" }));
    expect(screen.getByText(/Not synced yet/)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/do not sync to the notebook yet/);

    // A private claim arriving (e.g. a teammate's action merged into the wire
    // state) shows up live under the private tab only.
    useSessionStore.setState({
      state: wireState({
        claims: {
          "c.1": claim({ id: "c.1", text: "Shared note." }),
          "c.2": claim({ id: "c.2", text: "Check the printer logs alone.", private: true }),
        },
      }),
    });
    await waitFor(() => expect(screen.getByText("Check the printer logs alone.")).toBeInTheDocument());
    expect(screen.queryByText("Shared note.")).not.toBeInTheDocument();
  });

  it("keeps the case list live when EvidenceCollected events arrive", async () => {
    seedSession(wireState());
    render(<NotebookWindow />);
    expect(screen.getByText(/Nothing collected yet/)).toBeInTheDocument();

    // Simulate the store's event merge (what dispatch/WS do on collect).
    useSessionStore.getState().mergeEnvelopes([
      {
        seq: 1,
        event: {
          type: "EvidenceCollected",
          evidenceId: "e.9",
          artifactId: "a.printer",
          at: "2026-11-02T11:00:00.000Z",
          by: "user-1",
          actorKind: "human",
        },
      },
    ]);

    await waitFor(() =>
      expect(screen.getAllByText("a.printer").length).toBeGreaterThanOrEqual(1)
    );
    expect(screen.getByText(/1 shown/)).toBeInTheDocument();
  });
});
