import { create } from "zustand";
import type { Rejection } from "@iz/schema";
import { createIzClient, useSessionStore } from "@iz/ui";

/**
 * NODE TERMINAL session state (§10.5). The client never interprets commands:
 * every line is dispatched as a whole-line `terminal` action and the server
 * returns {output, cwd, connect?}. What this store owns is presentation state:
 * the scrollback buffer, the current host + cwd, and the passphrase-prompt
 * state machine — a gated host answers every command with
 * result.connect {target, gateId, connected:false} until the matching answer
 * gate is solved via submitAnswer.
 */

/** Scrollback cap: the last 500 lines are kept (display, not evidence). */
export const TERMINAL_BUFFER_CAP = 500;

export type TerminalLineKind = "out" | "err" | "cmd" | "sys";

export interface TerminalBufferLine {
  kind: TerminalLineKind;
  text: string;
  /**
   * Monotonic id, unique across the whole store lifetime. Renderers track what
   * they wrote by id, NOT by array index: Clear shrinks the buffer and the
   * 500-line cap rolls old lines off — index arithmetic goes blind in both.
   */
  n: number;
}

let lineCounter = 0;

export interface TerminalConnectInfo {
  target: string;
  gateId?: string;
  connected: boolean;
}

interface TerminalResultShape {
  output: string;
  cwd: string;
  connect?: TerminalConnectInfo;
}

interface TerminalState {
  /** Connected host (undefined = no session). */
  host: string | undefined;
  cwd: string;
  lines: TerminalBufferLine[];
  /** Set while a passphrase prompt is active: the gate awaiting an answer. */
  pendingGateId: string | undefined;
  motd: string | undefined;
  busy: boolean;
  /** Newest server rejection, shown once in the status strip. */
  lastError: string | undefined;
  /** Text for the always-on screen-reader announcement region (§11.5). */
  announcement: string | undefined;

  openHost(host: string): Promise<void>;
  submitLine(line: string): Promise<void>;
  submitPassphrase(answer: string): Promise<boolean>;
  /** Pure visual op: wipe scrollback (never touches the server). */
  clearBuffer(): void;
  reset(): void;
}

export function pushLines(
  lines: TerminalBufferLine[],
  additions: Array<Omit<TerminalBufferLine, "n">>
): TerminalBufferLine[] {
  const withIds = additions.map((line) => ({ ...line, n: ++lineCounter }));
  const next = [...lines, ...withIds];
  return next.length > TERMINAL_BUFFER_CAP ? next.slice(next.length - TERMINAL_BUFFER_CAP) : next;
}

function outputLines(output: string, kind: TerminalLineKind = "out"): Array<Omit<TerminalBufferLine, "n">> {
  const split = output.split("\n");
  // A trailing newline is layout, not an empty output line.
  if (split.length > 1 && split[split.length - 1] === "") split.pop();
  return split.map((text) => ({ kind, text }));
}

/** GET /api/view for the session banner (motd, gate state) — server authority. */
function viewFetch(): ReturnType<typeof createIzClient>["getView"] {
  // Created per call (mirrors browser/store.ts) so tests can stub globalThis
  // fetch and so a token refresh is always picked up.
  const client = createIzClient({ getToken: () => useSessionStore.getState().session?.token });
  return (host, path) => client.getView(host, path);
}

export const useTerminalStore = create<TerminalState>((set, get) => {
  /** Shared tail of every action: run a terminal dispatch and fold the result in. */
  const runTerminalLine = async (line: string, echo: Omit<TerminalBufferLine, "n"> | undefined): Promise<void> => {
    const { host, cwd, busy } = get();
    if (host === undefined || busy) return;
    set({ busy: true, lastError: undefined });
    if (echo !== undefined) set({ lines: pushLines(get().lines, [echo]) });
    const response = await useSessionStore.getState().dispatch({ type: "terminal", host, cwd, line });
    set({ busy: false });
    if (response.rejection !== undefined) {
      applyRejection(set, get, response.rejection);
      return;
    }
    const result = (response.result ?? {}) as Partial<TerminalResultShape>;
    applyResult(set, get, {
      output: typeof result.output === "string" ? result.output : "",
      cwd: typeof result.cwd === "string" ? result.cwd : cwd,
      ...(result.connect !== undefined && typeof result.connect === "object"
        ? { connect: result.connect as TerminalConnectInfo }
        : {}),
    });
  };

  return {
    host: undefined,
    cwd: "/",
    lines: [],
    pendingGateId: undefined,
    motd: undefined,
    busy: false,
    lastError: undefined,
    announcement: undefined,

    async openHost(host) {
      if (get().busy) return;
      set({
        host,
        cwd: "/",
        lines: [],
        pendingGateId: undefined,
        motd: undefined,
        lastError: undefined,
        busy: false,
        announcement: `Connecting to ${host}`,
      });
      // Session banner: the same server view snapshot the in-game browser
      // would render (motd). Best-effort — the probe below still gates.
      try {
        const response = await viewFetch()(host, "/");
        const view = response.view;
        if ("view" in view && view.view === "terminal" && view.host === host && view.motd !== null && view.motd !== "") {
          set({ motd: view.motd });
          set({ lines: pushLines(get().lines, outputLines(view.motd)) });
        }
      } catch {
        /* locked/unknown host or fetch hiccup: the probe reports it */
      }
      // First command doubles as the gate probe: a passphrase-gated host
      // answers ANY command with result.connect {gateId, connected:false}
      // (apps/server terminal-run.ts), an open one answers normally.
      await runTerminalLine("pwd", undefined);
    },

    async submitLine(line) {
      const { pendingGateId } = get();
      if (pendingGateId !== undefined) {
        await get().submitPassphrase(line);
        return;
      }
      const { host, cwd } = get();
      if (host === undefined) return;
      await runTerminalLine(line, { kind: "cmd", text: `${host}:${cwd}$ ${line}` });
    },

    async submitPassphrase(answer) {
      const gateId = get().pendingGateId;
      if (gateId === undefined || get().busy) return false;
      set({ busy: true, lastError: undefined });
      // The secret is never echoed to the scrollback.
      set({ lines: pushLines(get().lines, [{ kind: "sys", text: "· passphrase submitted ·" }]) });
      const response = await useSessionStore.getState().dispatch({ type: "submitAnswer", gateId, answer });
      if (response.rejection !== undefined) {
        set({ busy: false, pendingGateId: gateId });
        applyRejection(set, get, response.rejection);
        return false;
      }
      set({ busy: false, pendingGateId: undefined });
      set({ lines: pushLines(get().lines, [{ kind: "sys", text: "accepted — opening session" }]) });
      set({ announcement: "Passphrase accepted." });
      // Re-probe: with the gate solved the same command now returns real
      // output, the motd and the session cwd.
      await runTerminalLine("pwd", undefined);
      return true;
    },

    clearBuffer() {
      set({ lines: [], announcement: "Terminal cleared." });
    },

    reset() {
      set({
        host: undefined,
        cwd: "/",
        lines: [],
        pendingGateId: undefined,
        motd: undefined,
        busy: false,
        lastError: undefined,
        announcement: undefined,
      });
    },
  };
});

type StoreSet = (partial: Partial<TerminalState> | ((s: TerminalState) => Partial<TerminalState>)) => void;
type StoreGet = () => TerminalState;

function applyRejection(set: StoreSet, get: StoreGet, rejection: Rejection): void {
  const message = rejection.message;
  set({
    lines: pushLines(get().lines, [{ kind: "err", text: message }]),
    lastError: message,
    announcement: `Terminal error: ${message}`,
  });
}

function applyResult(set: StoreSet, get: StoreGet, result: TerminalResultShape): void {
  const state = get();
  const additions: Array<Omit<TerminalBufferLine, "n">> = [];
  let host = state.host;
  let cwd = result.cwd;
  let pendingGateId = state.pendingGateId;
  let announcement = "";

  const connect = result.connect;
  if (connect !== undefined) {
    if (connect.connected === false) {
      // Gated: the output IS the passphrase prompt ("connecting to X… /
      // passphrase: "). Remember the gate for submitAnswer.
      if (connect.target !== undefined && connect.target !== host) host = connect.target;
      pendingGateId = connect.gateId;
      additions.push(...outputLines(result.output));
      announcement = `Passphrase required for ${connect.target ?? host ?? "host"}.`;
    } else {
      // `connect <target>` succeeded: the session moves to the target host.
      if (connect.target !== undefined && connect.target !== host) {
        additions.push({ kind: "sys", text: `connected to ${connect.target}` });
        host = connect.target;
        cwd = "/";
        pendingGateId = undefined;
        announcement = `Connected to ${connect.target}.`;
      }
    }
  } else {
    additions.push(...outputLines(result.output));
    announcement = result.output.trim() === "" ? "" : result.output.trim().slice(0, 200);
  }

  set({
    host,
    cwd,
    pendingGateId,
    lines: pushLines(state.lines, additions),
    announcement: announcement === "" ? state.announcement : announcement,
  });
}

/** World hosts that run a terminal service — the picker's source. */
export function terminalHosts(worldHosts: ReadonlyArray<{ host: string; service: string; title?: string }> | undefined): Array<{ host: string; title: string }> {
  if (worldHosts === undefined) return [];
  return worldHosts
    .filter((h) => h.service === "terminal")
    .map((h) => ({ host: h.host, title: h.title ?? h.host }));
}
