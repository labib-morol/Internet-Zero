import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorldSummary } from "@iz/schema";
import { teamSocket, useSessionStore, type IzClient } from "@iz/ui";
import { useBrowserStore } from "../src/browser/store.js";
import { useTerminalStore } from "../src/services/terminal/terminal-store.js";
import { installSessionLifecycle } from "../src/session-lifecycle.js";
import { LandingPage } from "../src/landing/LandingPage.js";

/**
 * Task 2: session lifecycle must own presentation state.
 *  - A created guest keeps the one-time recovery code even when the follow-up
 *    state fetch fails; the retry path reuses the existing session.
 *  - Sign-out/expiry resets CASE presentation content (browser history, cached
 *    views, visited hosts, terminal scrollback/host) so the next guest on a
 *    shared machine never sees the previous case.
 */

const WORLD: WorldSummary = {
  worldId: "w.tutorial",
  title: "Lost and Found",
  summary: "A dead company's leftovers.",
  version: "1.0.0",
  bundleHash: "hash-1",
  entry: "forge.pinecone.pcp/pinecone/office-scripts",
  hosts: [],
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

function stubTeamSocket(): void {
  const socket = teamSocket as unknown as Record<string, () => void>;
  socket.start = () => undefined;
  socket.stop = () => undefined;
  socket.restart = () => undefined;
  socket.resetStream = () => undefined;
}

beforeEach(() => {
  stubTeamSocket();
  sessionStorage.clear();
  useSessionStore.getState().reset();
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
  useTerminalStore.getState().reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("session lifecycle owns presentation state", () => {
  it("a created guest keeps the recovery handoff when the first state fetch fails", async () => {
    const { setIzClientForTests } = await import("@iz/ui");
    let stateFailures = 1;
    const createSession = vi.fn(async () => ({
      teamId: "team-1",
      userId: "user-1",
      displayName: "Guest 4242",
      sessionToken: "tok-1",
      recoveryCode: "0123456789abcdef",
    }));
    const client = {
      createSession,
      getState: vi.fn(async () => {
        if (stateFailures > 0) {
          stateFailures -= 1;
          throw new Error("state fetch failed");
        }
        return { state: wireState() };
      }),
      listWorlds: vi.fn(async () => [WORLD]),
      logout: vi.fn(async () => undefined),
    } as unknown as IzClient & {
      createSession: ReturnType<typeof vi.fn>;
    };
    setIzClientForTests(client);

    await useSessionStore.getState().startGuest("tutorial");
    expect(useSessionStore.getState().status).toBe("error");
    // The one-time code survived the failure.
    expect(useSessionStore.getState().pendingRecoveryCode).toBe("0123456789abcdef");
    expect(sessionStorage.getItem("iz.session.token")).toBe("tok-1");

    // Retry uses the EXISTING session: no second create-session call.
    await useSessionStore.getState().bootstrap();
    expect(useSessionStore.getState().screen).toBe("shell");
    expect(useSessionStore.getState().session?.token).toBe("tok-1");
    expect(createSession).toHaveBeenCalledTimes(1);
    setIzClientForTests(undefined);
  });

  it("the landing offers a retry that re-enters the existing session", async () => {
    const { setIzClientForTests } = await import("@iz/ui");
    let stateFailures = 1;
    const createSession = vi.fn(async () => ({
      teamId: "team-1",
      userId: "user-1",
      displayName: "Guest 4242",
      sessionToken: "tok-1",
      recoveryCode: "0123456789abcdef",
    }));
    const client = {
      createSession,
      getState: vi.fn(async () => {
        if (stateFailures > 0) {
          stateFailures -= 1;
          throw new Error("state fetch failed");
        }
        return { state: wireState() };
      }),
      listWorlds: vi.fn(async () => [WORLD]),
      logout: vi.fn(async () => undefined),
    } as unknown as IzClient;
    setIzClientForTests(client);

    await useSessionStore.getState().startGuest("tutorial");
    expect(useSessionStore.getState().status).toBe("error");

    render(<LandingPage />);
    // The error carries a retry because a session already exists.
    const retry = await screen.findByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    await waitFor(() => expect(useSessionStore.getState().screen).toBe("shell"));
    expect(createSession).toHaveBeenCalledTimes(1);
    cleanup();
    setIzClientForTests(undefined);
  });

  it("signOut resets case presentation content for the next guest", async () => {
    const { setIzClientForTests } = await import("@iz/ui");
    const logout = vi.fn(async () => undefined);
    setIzClientForTests({ logout } as unknown as IzClient);
    const uninstall = installSessionLifecycle();

    // Seed case content as if a player had been investigating.
    useSessionStore.setState({
      session: { teamId: "team-1", userId: "u1", token: "tok-1" },
      screen: "shell",
    });
    useBrowserStore.setState({
      entries: [
        { host: "forge.pinecone.pcp", path: "/pinecone/office-scripts" },
        { host: "mail.pinecone.pcp", path: "/mb.odile" },
      ],
      index: 1,
      bookmarks: [{ host: "printer.pinecone.pcp", path: "/" }],
      visitedHosts: ["forge.pinecone.pcp", "mail.pinecone.pcp"],
      load: "ready",
    });
    useTerminalStore.setState({
      host: "printer.pinecone.pcp",
      lines: [{ kind: "out", text: "connected to printer", n: 1 }],
    });

    useSessionStore.getState().signOut();

    expect(logout).toHaveBeenCalledTimes(1);
    const browser = useBrowserStore.getState();
    expect(browser.entries).toEqual([]);
    expect(browser.bookmarks).toEqual([]);
    expect(browser.visitedHosts).toEqual([]);
    expect(browser.view).toBeUndefined();
    const terminal = useTerminalStore.getState();
    expect(terminal.host).toBeUndefined();
    expect(terminal.lines).toEqual([]);
    expect(useSessionStore.getState().session).toBeUndefined();
    uninstall();
    setIzClientForTests(undefined);
  });

  it("invalidate (session expired) resets case presentation content too", async () => {
    const { setIzClientForTests } = await import("@iz/ui");
    setIzClientForTests({ logout: vi.fn(async () => undefined) } as unknown as IzClient);
    const uninstall = installSessionLifecycle();

    useSessionStore.setState({
      session: { teamId: "team-1", userId: "u1", token: "tok-1" },
      screen: "shell",
    });
    useBrowserStore.setState({ visitedHosts: ["archive.pcp"], index: 0, entries: [{ host: "archive.pcp", path: "/" }] });
    useTerminalStore.setState({ host: "printer.pinecone.pcp", lines: [{ kind: "out", text: "stale", n: 1 }] });

    useSessionStore.getState().invalidate("Session expired");

    expect(useBrowserStore.getState().visitedHosts).toEqual([]);
    expect(useTerminalStore.getState().host).toBeUndefined();
    uninstall();
    setIzClientForTests(undefined);
  });
});
