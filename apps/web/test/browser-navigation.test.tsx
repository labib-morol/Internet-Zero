import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewModel } from "@iz/schema";
import { currentEntry, setViewFetchForTests, useBrowserStore, type Collectible } from "../src/browser/store.js";
import { BrowserWindow } from "../src/browser/BrowserWindow.js";
import { teamSocket, useSessionStore } from "@iz/ui";

/**
 * Task 4: navigation identity. A late response — success OR failure — must
 * never clobber a newer page, and an unparseable address gives feedback
 * instead of silently doing nothing.
 */

function viewFor(host: string): { view: ViewModel; collectibles: Collectible[] } {
  return { view: { notFound: true, host, path: "/" }, collectibles: [] };
}

function shownHost(): string | undefined {
  const view = useBrowserStore.getState().view;
  return view !== undefined && "host" in view ? view.host : undefined;
}

beforeEach(() => {
  const socket = teamSocket as unknown as Record<string, () => void>;
  socket.start = () => undefined;
  socket.stop = () => undefined;
  useSessionStore.getState().reset();
  useBrowserStore.getState().resetSessionContent();
});

afterEach(() => {
  setViewFetchForTests(undefined);
  vi.restoreAllMocks();
});

describe("browser navigation identity", () => {
  it("a late SUCCESS cannot overwrite a newer navigation", async () => {
    let releaseA: (() => void) | undefined;
    const fetchImpl: Parameters<typeof setViewFetchForTests>[0] = (host) => {
      if (host === "a.pcp") {
        return new Promise((resolve) => {
          releaseA = () => resolve(viewFor("a.pcp"));
        });
      }
      return Promise.resolve(viewFor(host));
    };
    setViewFetchForTests(fetchImpl);

    const first = useBrowserStore.getState().navigate("a.pcp", "/");
    await vi.waitFor(() => expect(useBrowserStore.getState().load).toBe("loading"));
    await useBrowserStore.getState().navigate("b.pcp", "/");
    await vi.waitFor(() => expect(useBrowserStore.getState().load).toBe("ready"));
    expect(shownHost()).toBe("b.pcp");
    releaseA?.();
    await first;
    // The late A response must not replace B's page.
    expect(shownHost()).toBe("b.pcp");
    expect(currentEntry(useBrowserStore.getState())?.host).toBe("b.pcp");
  });

  it("a late FAILURE cannot clobber a newer success", async () => {
    let rejectA: ((error: Error) => void) | undefined;
    const fetchImpl: Parameters<typeof setViewFetchForTests>[0] = (host) => {
      if (host === "a.pcp") {
        return new Promise((_resolve, reject) => {
          rejectA = reject;
        });
      }
      return Promise.resolve(viewFor(host));
    };
    setViewFetchForTests(fetchImpl);

    const first = useBrowserStore.getState().navigate("a.pcp", "/");
    await useBrowserStore.getState().navigate("b.pcp", "/");
    await vi.waitFor(() => expect(useBrowserStore.getState().load).toBe("ready"));
    rejectA?.(new Error("a.pcp exploded late"));
    await first;
    expect(useBrowserStore.getState().load).toBe("ready");
    expect(useBrowserStore.getState().error).toBeUndefined();
    expect(shownHost()).toBe("b.pcp");
  });

  it("an invalid address shows actionable feedback", async () => {
    const ok = await useBrowserStore.getState().goToAddress("not a valid host at all");
    expect(ok).toBe(false);
    expect(useBrowserStore.getState().load).toBe("error");
    expect(useBrowserStore.getState().error).toMatch(/address/i);
  });

  it("a failed navigation never renders the previous page under the new address", async () => {
    setViewFetchForTests((host) =>
      host === "b.pcp" ? Promise.reject(new Error("b.pcp is unreachable")) : Promise.resolve(viewFor(host))
    );

    await useBrowserStore.getState().navigate("a.pcp", "/");
    expect(useBrowserStore.getState().load).toBe("ready");
    await useBrowserStore.getState().navigate("b.pcp", "/");
    expect(useBrowserStore.getState().load).toBe("error");

    const { render, cleanup } = await import("@testing-library/react");
    const { screen } = await import("@testing-library/react");
    render(<BrowserWindow />);
    expect(screen.getByText(/Connection problem/)).toBeInTheDocument();
    // The previous page must not lurk beneath the error under b.pcp.
    expect(screen.queryByText(/a\.pcp/)).toBeNull();
    cleanup();
  });
});
