import { create } from "zustand";
import type { ViewModel } from "@iz/schema";
import { announce, createIzClient, useSessionStore } from "@iz/ui";

/**
 * In-game browser state (§10.1). History, back/forward and bookmarks are
 * CLIENT state only — this module never touches window.location and never
 * navigates the real browser. Views come from GET /api/view (server authority
 * on visibility); each navigation also POSTs an `open` action so the event
 * log records ArtifactViewed.
 */

export interface NavEntry {
  host: string;
  path: string;
}

export interface Collectible {
  artifactId: string;
  label: string;
}

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface BrowserState {
  entries: NavEntry[];
  index: number;
  bookmarks: NavEntry[];
  load: LoadStatus;
  view: ViewModel | undefined;
  collectibles: Collectible[];
  error: string | undefined;
  /** Every host this browser session has displayed (network directory seed). */
  visitedHosts: string[];

  navigate(host: string, path: string): Promise<void>;
  /** Address-bar entry point: accepts "host/path" or "http://host/path". */
  goToAddress(address: string): Promise<boolean>;
  back(): Promise<void>;
  forward(): Promise<void>;
  toggleBookmark(): void;
  collect(artifactId: string, label?: string): Promise<boolean>;
  /** Collect the selected range of the current view (select-then-press-C). */
  collectSelection(fragment: { kind: "range"; start: number; end: number }): Promise<boolean>;
}

export function parseAddress(input: string): NavEntry | undefined {
  const trimmed = input.trim().replace(/^https?:\/\//i, "");
  if (trimmed === "") return undefined;
  const slash = trimmed.indexOf("/");
  const host = (slash === -1 ? trimmed : trimmed.slice(0, slash)).toLowerCase();
  if (host === "" || /\s/.test(host) || host.includes("@") || host.includes("?")) return undefined;
  const rawPath = slash === -1 ? "" : trimmed.slice(slash);
  return { host, path: rawPath === "" ? "/" : rawPath };
}

export function formatAddress(entry: NavEntry): string {
  return entry.path === "/" ? entry.host : `${entry.host}${entry.path}`;
}

/** View kind → service name (for evidence provenance hints). */
function serviceOfView(view: ViewModel | undefined): string {
  if (view === undefined || "notFound" in view) return "archive";
  switch (view.view) {
    case "repo-home":
    case "commit-list":
    case "commit-detail":
    case "file-browser":
    case "issue-list":
    case "issue-detail":
    case "user-profile":
      return "forge";
    case "mailbox":
    case "thread":
    case "message":
      return "mail";
    case "terminal":
      return "terminal";
    default:
      return "archive";
  }
}

function pushVisited(visited: string[], host: string): string[] {
  return visited.includes(host) ? visited : [...visited, host];
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  entries: [],
  index: -1,
  bookmarks: [],
  load: "idle",
  view: undefined,
  collectibles: [],
  error: undefined,
  visitedHosts: [],

  async navigate(host, path) {
    const normalized: NavEntry = { host: host.toLowerCase(), path: path === "" ? "/" : path };
    const { entries, index } = get();
    // Same page: just reload the view.
    const current = entries[index];
    const samePage = current !== undefined && current.host === normalized.host && current.path === normalized.path;
    const nextEntries = samePage ? entries : [...entries.slice(0, index + 1), normalized];
    const nextIndex = samePage ? index : nextEntries.length - 1;
    set({
      entries: nextEntries,
      index: nextIndex,
      load: "loading",
      error: undefined,
      visitedHosts: pushVisited(get().visitedHosts, normalized.host),
    });

    const session = useSessionStore.getState();
    // Record the navigation in the event log; the VIEW fetch decides what is
    // rendered (locked/unknown hosts are indistinguishable notFounds, §10.1).
    void session.dispatch({ type: "open", url: `${normalized.host}${normalized.path}` });
    try {
      const response = await createViewFetch()(normalized.host, normalized.path);
      // Ignore stale responses (address bar moved on meanwhile).
      if (get().index !== nextIndex || get().entries[nextIndex] !== nextEntries[nextIndex]) return;
      set({ load: "ready", view: response.view, collectibles: response.collectibles });
    } catch (error) {
      set({ load: "error", error: error instanceof Error ? error.message : "The page could not be loaded." });
    }
  },

  async goToAddress(address) {
    const parsed = parseAddress(address);
    if (parsed === undefined) return false;
    await get().navigate(parsed.host, parsed.path);
    return true;
  },

  async back() {
    const { index } = get();
    if (index <= 0) return;
    set({ index: index - 1 });
    const entry = get().entries[get().index];
    if (entry === undefined) return;
    set({ load: "loading" });
    await loadCurrent(set, get, entry);
  },

  async forward() {
    const { index, entries } = get();
    if (index >= entries.length - 1) return;
    set({ index: index + 1 });
    const entry = get().entries[get().index];
    if (entry === undefined) return;
    set({ load: "loading" });
    await loadCurrent(set, get, entry);
  },

  toggleBookmark() {
    const { entries, index, bookmarks } = get();
    const entry = entries[index];
    if (entry === undefined) return;
    const exists = bookmarks.some((b) => b.host === entry.host && b.path === entry.path);
    set({
      bookmarks: exists
        ? bookmarks.filter((b) => !(b.host === entry.host && b.path === entry.path))
        : [...bookmarks, entry],
    });
  },

  async collect(artifactId, label) {
    const session = useSessionStore.getState();
    const current = get().entries[get().index];
    const response = await session.dispatch(
      { type: "collect", artifactId },
      {
        provenance: {
          // Evidence collected from THIS view gets precise provenance; events
          // for teammates' collects fall back to empty and refresh on next
          // authoritative state fetch (see applyEventsToWire docs).
          ...(current !== undefined
            ? {
                [artifactId]: {
                  host: current.host,
                  path: current.path,
                  service: serviceOfView(get().view),
                },
              }
            : {}),
        },
      }
    );
    if (response.rejection !== undefined) return false;
    announce(label !== undefined ? `Collected: ${label}` : `Collected evidence ${artifactId}.`);
    return true;
  },

  async collectSelection(fragment) {
    const view = get().view;
    const artifactId = view !== undefined && "artifactId" in view ? view.artifactId : undefined;
    if (artifactId === undefined || artifactId === null) return false;
    return get().collect(artifactId, `selection (${fragment.end - fragment.start} chars)`);
  },
}));

async function loadCurrent(
  set: (partial: Partial<BrowserState>) => void,
  get: () => BrowserState,
  entry: NavEntry
): Promise<void> {
  try {
    const response = await createViewFetch()(entry.host, entry.path);
    set({ load: "ready", view: response.view, collectibles: response.collectibles, error: undefined });
  } catch (error) {
    set({ load: "error", error: error instanceof Error ? error.message : "The page could not be loaded." });
  }
}

/** Indirection so tests can stub view fetches without module mocking. */
type ViewFetch = (host: string, path: string) => Promise<{ view: ViewModel; collectibles: Collectible[] }>;
let viewFetch: ViewFetch | undefined;

export function setViewFetchForTests(impl: ViewFetch | undefined): void {
  viewFetch = impl;
}

function createViewFetch(): ViewFetch {
  if (viewFetch !== undefined) return viewFetch;
  const izClient = createIzClient({ getToken: () => useSessionStore.getState().session?.token });
  return (host, path) => izClient.getView(host, path);
}

export function currentEntry(state: BrowserState): NavEntry | undefined {
  return state.entries[state.index];
}
