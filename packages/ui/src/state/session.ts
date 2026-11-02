import { create } from "zustand";
import type { Action, GameEvent, Rejection, WorldSummary } from "@iz/schema";
import type { EventEnvelope } from "@iz/schema";
import { ApiError, createIzClient, type IzClient } from "../api/client.js";
import { TeamSocket } from "../api/ws.js";
import { applyEventsToWire } from "./events.js";
import type { MergeContext } from "./events.js";
import type { WireRuntimeState } from "./wire.js";
import { announce } from "../live.js";

/**
 * Central session store: session, world, team state (wire form), connection
 * status, and the single dispatch() write path. The server is the authority:
 * dispatch posts the action and merges the RETURNED events into the local
 * presentation state; WebSocket broadcasts merge through the same reducer with
 * duplicate suppression (the same event can arrive via REST and WS).
 *
 * Token persistence: sessionStorage under IZ_TOKEN_KEY. The recovery code is
 * NEVER persisted — it is shown once (§15) by the landing flow.
 */

export const IZ_TOKEN_KEY = "iz.session.token";

/** Cap on the duplicate-suppression window (events, not envelopes). */
const SEEN_CAP = 1000;

export type Screen = "landing" | "shell";
export type SessionStatus = "idle" | "starting" | "ready" | "error";

export interface SessionInfo {
  teamId: string;
  userId: string;
  displayName?: string;
  token: string;
}

interface SessionStore {
  screen: Screen;
  status: SessionStatus;
  error: string | undefined;
  session: SessionInfo | undefined;
  world: WorldSummary | undefined;
  worlds: WorldSummary[];
  state: WireRuntimeState | undefined;
  connection: "online" | "connecting" | "offline";
  /**
   * Recovery code from a fresh guest start, held ONLY until the one-time
   * modal is dismissed (§15). Never persisted.
   */
  pendingRecoveryCode: string | undefined;
  /** Internal: canonical JSON of recently merged events (duplicate guard). */
  seenEvents: string[];

  bootstrap(): Promise<void>;
  loadWorlds(): Promise<WorldSummary[]>;
  startGuest(worldId: string): Promise<void>;
  resume(recoveryCode: string): Promise<void>;
  dismissRecoveryCode(): void;
  signOut(): void;
  /** 401 anywhere: drop the session and return to the landing page. */
  invalidate(reason: string): void;
  refreshState(): Promise<void>;
  dispatch(
    action: Action,
    context?: MergeContext
  ): Promise<{ result?: unknown; rejection?: Rejection }>;
  setConnection(connection: "online" | "connecting" | "offline"): void;
  mergeEnvelopes(envelopes: readonly EventEnvelope[], context?: MergeContext): void;
  reset(): void;
}

function tokenStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  try {
    if (typeof sessionStorage === "undefined") return undefined;
    return sessionStorage;
  } catch {
    return undefined; // private mode / disabled storage
  }
}

export function readStoredToken(): string | undefined {
  try {
    return tokenStorage()?.getItem(IZ_TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeToken(token: string | undefined): void {
  try {
    const storage = tokenStorage();
    if (storage === undefined) return;
    if (token === undefined) storage.removeItem(IZ_TOKEN_KEY);
    else storage.setItem(IZ_TOKEN_KEY, token);
  } catch {
    /* storage unavailable — session lives in memory only */
  }
}

let client: IzClient | undefined;

function getClient(): IzClient {
  if (client === undefined) {
    client = createIzClient({
      // The token may exist before the store does (bootstrap from sessionStorage,
      // fresh guest/resume flows call getState before the session lands in the
      // store) — so fall back to the persisted token.
      getToken: () => useSessionStore.getState().session?.token ?? readStoredToken(),
    });
  }
  return client;
}

/** Test seam: replace the REST client. */
export function setIzClientForTests(override: IzClient | undefined): void {
  client = override;
}

/** Shared team socket; the shell starts it once a session exists. */
export const teamSocket = new TeamSocket({
  onEnvelopes: (envelopes) => useSessionStore.getState().mergeEnvelopes(envelopes),
  onStatus: (status) => {
    if (status === "unauthorized") {
      useSessionStore.getState().invalidate("Session expired");
      return;
    }
    useSessionStore.getState().setConnection(status);
    if (status === "online") announce("Connected to the case stream.");
    if (status === "offline") announce("Connection lost; reconnecting…");
  },
});

export const useSessionStore = create<SessionStore>((set, get) => ({
  screen: "landing",
  status: "idle",
  error: undefined,
  session: undefined,
  world: undefined,
  worlds: [],
  state: undefined,
  connection: "offline",
  pendingRecoveryCode: undefined,
  seenEvents: [],

  async bootstrap() {
    const token = readStoredToken();
    if (token === undefined) {
      set({ screen: "landing", status: "idle" });
      return;
    }
    set({ status: "starting" });
    try {
      const [state, worlds] = await Promise.all([getClient().getState(), getClient().listWorlds()]);
      const world = worlds.find((w) => w.worldId === state.worldId);
      set({
        session: { teamId: state.teamId, userId: "", token },
        world,
        worlds,
        state,
        screen: "shell",
        status: "ready",
        error: undefined,
      });
      teamSocket.start(token);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        storeToken(undefined);
        set({ screen: "landing", status: "idle", session: undefined, state: undefined });
      } else {
        set({ status: "error", error: describeError(error) });
      }
    }
  },

  async loadWorlds() {
    const worlds = await getClient().listWorlds();
    set({ worlds });
    return worlds;
  },

  async startGuest(worldId) {
    set({ status: "starting", error: undefined });
    try {
      const created = await getClient().createSession(worldId);
      storeToken(created.sessionToken);
      const state = await getClient().getState();
      const worlds = get().worlds.length > 0 ? get().worlds : await getClient().listWorlds();
      const world = worlds.find((w) => w.worldId === state.worldId);
      set({
        session: {
          teamId: created.teamId,
          userId: created.userId,
          displayName: created.displayName,
          token: created.sessionToken,
        },
        world,
        worlds,
        state,
        screen: "shell",
        status: "ready",
        connection: "connecting",
        pendingRecoveryCode: created.recoveryCode,
      });
      teamSocket.start(created.sessionToken);
      announce(`Session started. Welcome, ${created.displayName}.`);
    } catch (error) {
      set({ status: "error", error: describeError(error) });
    }
  },

  async resume(recoveryCode) {
    set({ status: "starting", error: undefined });
    try {
      const resumed = await getClient().resumeSession(recoveryCode.trim());
      storeToken(resumed.sessionToken);
      const state = await getClient().getState();
      const worlds = get().worlds.length > 0 ? get().worlds : await getClient().listWorlds();
      const world = worlds.find((w) => w.worldId === state.worldId);
      set({
        session: { teamId: resumed.teamId, userId: resumed.userId, token: resumed.sessionToken },
        world,
        worlds,
        state,
        screen: "shell",
        status: "ready",
        connection: "connecting",
      });
      teamSocket.start(resumed.sessionToken);
      announce("Session resumed.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        set({ status: "error", error: "That recovery code was not recognised." });
      } else {
        set({ status: "error", error: describeError(error) });
      }
    }
  },

  dismissRecoveryCode() {
    set({ pendingRecoveryCode: undefined });
  },

  signOut() {
    storeToken(undefined);
    teamSocket.stop();
    set({
      screen: "landing",
      status: "idle",
      session: undefined,
      world: undefined,
      state: undefined,
      connection: "offline",
      error: undefined,
      pendingRecoveryCode: undefined,
    });
  },

  invalidate(reason) {
    storeToken(undefined);
    teamSocket.stop();
    set({
      screen: "landing",
      status: "idle",
      session: undefined,
      world: undefined,
      state: undefined,
      connection: "offline",
      error: reason,
      pendingRecoveryCode: undefined,
    });
    announce(reason, true);
  },

  async refreshState() {
    const state = await getClient().getState();
    set({ state });
  },

  async dispatch(action, context) {
    const current = get().session;
    if (current === undefined) return { rejection: { code: "unauthorized", message: "No session." } };
    try {
      const response = await getClient().submit(action);
      get().mergeEnvelopes(
        response.events.map((event) => ({ seq: 0, event })),
        context
      );
      // Keep the authoritative unlocked/firedEvents sets fresh after events
      // that carry bundle-derived unlocks (GateSolved, WorldEventFired).
      const unlocksPossible = response.events.some(
        (e: GameEvent) => e.type === "GateSolved" || e.type === "WorldEventFired"
      );
      if (unlocksPossible) {
        await get().refreshState();
        const worlds = await getClient().listWorlds();
        set({ worlds, world: worlds.find((w) => w.worldId === get().state?.worldId) });
      }
      if (response.rejection !== undefined) {
        announce(`Rejected: ${response.rejection.message}`, true);
      }
      return { result: response.result, rejection: response.rejection };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        get().invalidate("Session expired");
        return { rejection: { code: "unauthorized", message: "Session expired." } };
      }
      announce("The request could not be completed.", true);
      return { rejection: { code: "conflict", message: describeError(error) } };
    }
  },

  setConnection(connection) {
    if (get().connection !== connection) set({ connection });
  },

  mergeEnvelopes(envelopes, context = {}) {
    if (envelopes.length === 0) return;
    const { seenEvents, state } = get();
    const seen = new Set(seenEvents);
    const fresh: GameEvent[] = [];
    for (const { event } of envelopes) {
      const key = JSON.stringify(event);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(event);
    }
    if (fresh.length === 0) return;
    const nextSeen = [...seen];
    while (nextSeen.length > SEEN_CAP) nextSeen.shift();
    const nextState =
      state !== undefined ? applyEventsToWire(state, fresh, context) : state;
    const notable = fresh.find(
      (e) => e.type === "GateSolved" || e.type === "ReportGroupAccepted"
    );
    if (notable !== undefined) {
      if (notable.type === "GateSolved") announce(`Gate solved: ${notable.gateId}. Score ${nextState?.score ?? ""}`.trim());
      if (notable.type === "ReportGroupAccepted") announce(`Report group accepted: ${notable.groupId}.`);
    }
    set({ state: nextState, seenEvents: nextSeen });
  },

  reset() {
    teamSocket.stop();
    set({
      screen: "landing",
      status: "idle",
      error: undefined,
      session: undefined,
      world: undefined,
      state: undefined,
      connection: "offline",
      pendingRecoveryCode: undefined,
      seenEvents: [],
    });
  },
}));

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
