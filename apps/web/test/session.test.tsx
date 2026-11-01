import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorldSummary } from "@iz/schema";
import { teamSocket, useSessionStore, type IzClient } from "@iz/ui";
import { LandingPage } from "../src/landing/LandingPage.js";
import { Shell } from "../src/shell/Shell.js";

const WORLD: WorldSummary = {
  worldId: "w.tutorial",
  title: "Lost and Found",
  summary: "A dead company's leftovers, one week after the lights went out.",
  version: "1.0.0",
  bundleHash: "hash-1",
  entry: "forge.pinecone.pcp/pinecone/office-scripts",
  hosts: [
    { host: "forge.pinecone.pcp", service: "forge", title: "GIT//FORGE" },
    { host: "mail.pinecone.pcp", service: "mail", title: "DEADLETTER" },
    { host: "printer.pinecone.pcp", service: "terminal", title: "NODE TERMINAL" },
  ],
};

function wireState() {
  return {
    teamId: "team-1",
    worldId: "w.tutorial",
    bundleHash: "hash-1",
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
  return fetchMock;
}

/** Replace the shared TeamSocket with an inert stub (no sockets in tests). */
function stubTeamSocket(): void {
  const socket = teamSocket as unknown as { start: () => void; stop: () => void };
  socket.start = () => undefined;
  socket.stop = () => undefined;
}

function resetStores(): void {
  localStorage.clear();
  sessionStorage.clear();
  useSessionStore.getState().reset();
}

beforeEach(() => {
  stubTeamSocket();
  resetStores();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("guest session flow (§11.3, §15)", () => {
  it("creates a guest session, shows the recovery code once, then lands on the entry host", async () => {
    const requests: string[] = [];
    installFetch([
      (url, init) => {
        // /api/worlds sits behind the session guard: 401 until a token exists.
        if (url.endsWith("/api/worlds")) {
          const auth = new Headers(init?.headers).get("authorization");
          if (auth === null) return { status: 401, body: { error: "unauthorized" } };
          return { status: 200, body: { worlds: [WORLD] } };
        }
        return undefined;
      },
      (url, init) => {
        if (url.endsWith("/api/sessions") && init?.method === "POST") {
          requests.push(`create-session:${String(init.body)}`);
          return {
            status: 201,
            body: {
              teamId: "team-1",
              userId: "user-1",
              displayName: "Guest 4242",
              sessionToken: "tok-1",
              recoveryCode: "0123456789abcdef",
            },
          };
        }
        return undefined;
      },
      (url) => {
        if (url.endsWith("/api/state")) {
          requests.push("state");
          return { status: 200, body: { state: wireState() } };
        }
        return undefined;
      },
      (url) => {
        if (url.includes("/api/view")) {
          requests.push("view");
          return {
            status: 200,
            body: {
              view: {
                view: "repo-home",
                artifactId: "a.readme",
                owner: "pinecone",
                name: "office-scripts",
                description: "Scripts from the office printer",
                defaultBranch: "main",
                readmeAst: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "Welcome back, employees." }] }] },
                recentCommits: [],
                openIssues: [],
              },
              collectibles: [{ artifactId: "a.readme", label: "README" }],
            },
          };
        }
        return undefined;
      },
      (url, init) => {
        if (url.endsWith("/api/actions") && init?.method === "POST") {
          requests.push("action");
          return { status: 200, body: { events: [] } };
        }
        return undefined;
      },
    ]);

    render(<LandingPage />);
    const start = await screen.findByRole("button", { name: "Open the case" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);

    // The store has the session and holds the one-time recovery code.
    await waitFor(() => expect(useSessionStore.getState().pendingRecoveryCode).toBe("0123456789abcdef"));
    expect(useSessionStore.getState().screen).toBe("shell");
    expect(sessionStorage.getItem("iz.session.token")).toBe("tok-1");
    // The landing fell back to the public tutorial's stable world id.
    expect(requests.some((r) => r.includes('"worldId":"tutorial"'))).toBe(true);
    cleanup(); // the landing page is replaced by the shell

    render(<Shell />);
    const modal = await screen.findByRole("dialog", { name: /Save your recovery code/ });
    expect(modal).toHaveTextContent("0123456789abcdef");

    // Dismissing clears the code; it cannot be shown again.
    fireEvent.click(screen.getByRole("button", { name: "I've saved it — open the desktop" }));
    await waitFor(() => expect(useSessionStore.getState().pendingRecoveryCode).toBeUndefined());
    expect(screen.queryByRole("dialog", { name: /Save your recovery code/ })).toBeNull();

    // Desktop shell: session name, world title, and the browser on the entry host.
    expect(await screen.findByText("Guest 4242")).toBeInTheDocument();
    expect(screen.getByText("Lost and Found")).toBeInTheDocument();
    const address = await screen.findByLabelText("In-game address");
    await waitFor(() => expect(address).toHaveValue("forge.pinecone.pcp/pinecone/office-scripts"));

    // The real write path was used: POST /api/actions for the open.
    expect(requests).toContain("action");
    expect(requests).toContain("view");
  });

  it("resumes with a recovery code and surfaces bad codes honestly", async () => {
    const { setIzClientForTests, ApiError } = await import("@iz/ui");
    const client = {
      resumeSession: vi.fn(async (code: string) => {
        if (code !== "aaaaaaaaaaaaaaaa") throw new ApiError(401, "invalid recovery code");
        return { teamId: "team-1", userId: "user-9", sessionToken: "tok-9" };
      }),
      getState: vi.fn(async () => wireState()),
      listWorlds: vi.fn(async () => [WORLD]),
    } as unknown as IzClient & { resumeSession: ReturnType<typeof vi.fn> };
    setIzClientForTests(client);

    render(<LandingPage />);
    const input = screen.getByLabelText(/Resume with a recovery code/i);
    const resume = screen.getByRole("button", { name: "Resume" });
    expect(resume).toBeDisabled();

    fireEvent.change(input, { target: { value: "wrong-wrong-wrong" } });
    fireEvent.click(resume);
    await waitFor(() => expect(useSessionStore.getState().error).toContain("not recognised"));
    expect(useSessionStore.getState().screen).toBe("landing");

    fireEvent.change(input, { target: { value: "aaaaaaaaaaaaaaaa" } });
    fireEvent.click(resume);
    await waitFor(() => expect(useSessionStore.getState().screen).toBe("shell"));
    expect(useSessionStore.getState().session?.token).toBe("tok-9");
    setIzClientForTests(undefined);
  });

  it("returns to the landing page with a message when the session expired (401)", async () => {
    const { setIzClientForTests, ApiError } = await import("@iz/ui");
    const client = {
      getState: vi.fn(async () => {
        throw new ApiError(401, "unauthorized");
      }),
      listWorlds: vi.fn(async () => [WORLD]),
    } as unknown as IzClient;
    setIzClientForTests(client);
    sessionStorage.setItem("iz.session.token", "stale-token");

    await useSessionStore.getState().bootstrap();
    const state = useSessionStore.getState();
    expect(state.screen).toBe("landing");
    expect(state.session).toBeUndefined();
    expect(sessionStorage.getItem("iz.session.token")).toBeNull();
    setIzClientForTests(undefined);
  });
});
