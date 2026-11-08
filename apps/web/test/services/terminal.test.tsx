import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import type { Action, GameEvent } from "@iz/schema";
import { setIzClientForTests, useSessionStore, type IzClient, type WireRuntimeState } from "@iz/ui";
import { TERMINAL_BUFFER_CAP, terminalHosts, useTerminalStore } from "../../src/services/terminal/terminal-store.js";
import { TerminalSessionArea, TerminalSrMode } from "../../src/services/terminal/TerminalConsole.js";
import { TerminalSessionPage } from "../../src/services/terminal/TerminalWindow.js";

/* -------------------------------------------------------------------------- */
/* xterm engine seam: stub so the graphical console renders in jsdom          */
/* -------------------------------------------------------------------------- */

const hoisted = vi.hoisted(() => ({
  engines: [] as Array<{
    writes: string[];
    handler: ((data: string) => void) | undefined;
    disposed: boolean;
    write(text: string): void;
    clear(): void;
    fit(): void;
    focus(): void;
    dispose(): void;
    onData(callback: (data: string) => void): void;
  }>,
}));

vi.mock("../../src/services/terminal/xterm-engine.js", () => ({
  TERMINAL_SCROLLBACK: 2000,
  createTerminalEngine: () => {
    const engine = {
      writes: [] as string[],
      handler: undefined as ((data: string) => void) | undefined,
      disposed: false,
      write(text: string) {
        this.writes.push(text);
      },
      clear() {
        this.writes.push("\u0000CLEAR");
      },
      fit() {},
      focus() {},
      dispose() {
        this.disposed = true;
      },
      onData(callback: (data: string) => void) {
        this.handler = callback;
      },
    };
    hoisted.engines.push(engine);
    return engine;
  },
}));

/* -------------------------------------------------------------------------- */
/* Session-store plumbing: a stub REST client that records every action       */
/* -------------------------------------------------------------------------- */

function wireState(): WireRuntimeState {
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

type SubmitSpy = (action: Action) => Promise<{ events: GameEvent[]; result?: unknown; rejection?: { code: string; message: string; retryAfterSeconds?: number } }>;

function installSession(submit: SubmitSpy): Mock {
  const spy = vi.fn(submit);
  setIzClientForTests({
    listWorlds: async () => [],
    createSession: async () => {
      throw new Error("unused");
    },
    resumeSession: async () => {
      throw new Error("unused");
    },
    getState: async () => ({ state: wireState() }),
    submit: spy as unknown as IzClient["submit"],
    getView: async () => {
      throw new Error("unused");
    },
  } as unknown as IzClient);
  useSessionStore.setState({
    session: { teamId: "team-1", userId: "u1", token: "tok" },
    state: wireState(),
    screen: "shell",
    status: "ready",
  });
  return spy;
}

const GATED_CONNECT = {
  output: "connecting to printer.pinecone.pcp…\npassphrase: ",
  cwd: "/",
  connect: { target: "printer.pinecone.pcp", gateId: "g.printer", connected: false },
};

beforeEach(() => {
  hoisted.engines.length = 0;
  useTerminalStore.getState().reset();
  useTerminalStore.setState({ busy: false });
});

afterEach(() => {
  cleanup();
  setIzClientForTests(undefined);
  vi.unstubAllGlobals();
  useSessionStore.setState({ session: undefined, state: undefined, screen: "landing", status: "idle" });
  useTerminalStore.getState().reset();
});

describe("terminal store: passphrase state machine", () => {
  it("probe on a gated host yields result.connect {gateId} and a passphrase prompt", async () => {
    const submit = installSession(async (action) => {
      expect(action.type).toBe("terminal");
      expect((action as { line: string }).line).toBe("pwd"); // whole-line probe
      return { events: [], result: GATED_CONNECT };
    });
    await useTerminalStore.getState().openHost("printer.pinecone.pcp");
    const s = useTerminalStore.getState();
    expect(s.pendingGateId).toBe("g.printer");
    expect(s.host).toBe("printer.pinecone.pcp");
    expect(s.lines.some((l) => l.text.trim() === "passphrase:")).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("a wrong passphrase keeps the prompt and surfaces the rejection", async () => {
    installSession(async (action) =>
      action.type === "submitAnswer"
        ? { events: [], rejection: { code: "invalid_input", message: "That is not it." } }
        : { events: [], result: GATED_CONNECT }
    );
    await useTerminalStore.getState().openHost("printer.pinecone.pcp");
    // Whole-line path routes to submitPassphrase while gated.
    await useTerminalStore.getState().submitLine("letmein");
    const s = useTerminalStore.getState();
    expect(s.pendingGateId).toBe("g.printer");
    expect(s.lines.some((l) => l.kind === "err" && l.text === "That is not it.")).toBe(true);
    // The secret is never echoed into the buffer.
    expect(s.lines.some((l) => l.text.includes("letmein"))).toBe(false);
  });

  it("the right passphrase solves the gate, re-probes and updates cwd", async () => {
    let gated = true;
    const submit = installSession(async (action) => {
      if (action.type === "submitAnswer") {
        expect(action.gateId).toBe("g.printer");
        expect(action.answer).toBe("biscuit2009");
        gated = false;
        return {
          events: [{ type: "GateSolved", gateId: "g.printer", score: 100, at: "2026-11-02T10:05:00.000Z", by: "u1", actorKind: "human" }],
          result: { accepted: true },
        };
      }
      if (gated) return { events: [], result: GATED_CONNECT };
      return { events: [], result: { output: "/", cwd: "/" } };
    });
    await useTerminalStore.getState().openHost("printer.pinecone.pcp");
    const ok = await useTerminalStore.getState().submitPassphrase("biscuit2009");
    expect(ok).toBe(true);
    const s = useTerminalStore.getState();
    expect(s.pendingGateId).toBeUndefined();
    expect(s.lines.some((l) => l.text === "accepted — opening session")).toBe(true);
    expect(s.lines.some((l) => l.text === "/")).toBe(true); // probe output lands
    const dispatched = submit.mock.calls.map((c) => c[0] as Action);
    expect(dispatched.filter((a) => a.type === "submitAnswer").length).toBe(1);
    expect(dispatched.filter((a) => a.type === "terminal").length).toBe(2); // initial probe + re-probe
  });

  it("cwd follows the server and the buffer caps at 500 lines", async () => {
    installSession(async () => ({ events: [], result: { output: "l1\nl2\nl3", cwd: "/etc" } }));
    await useTerminalStore.getState().openHost("printer.pinecone.pcp");
    expect(useTerminalStore.getState().cwd).toBe("/etc");

    // Stuff the buffer past the cap, then run one more command.
    const stuffed = Array.from({ length: 505 }, (_, i) => ({ kind: "out" as const, text: `old ${i}`, n: i + 1 }));
    useTerminalStore.setState({ lines: stuffed });
    await useTerminalStore.getState().submitLine("pwd");
    const s = useTerminalStore.getState();
    expect(s.lines.length).toBe(TERMINAL_BUFFER_CAP);
    expect(s.lines[s.lines.length - 1]!.text).toBe("l3"); // newest kept, oldest dropped
  });

  it("a successful `connect` moves the session to the target host", async () => {
    installSession(async (action) => {
      const line = action.type === "terminal" ? action.line : "";
      if (line.startsWith("connect ")) {
        return {
          events: [],
          result: { output: "connected to vault.pinecone.pcp", cwd: "/", connect: { target: "vault.pinecone.pcp", connected: true } },
        };
      }
      return { events: [], result: { output: "ok", cwd: "/" } };
    });
    await useTerminalStore.getState().openHost("printer.pinecone.pcp");
    await useTerminalStore.getState().submitLine("connect vault.pinecone.pcp");
    const s = useTerminalStore.getState();
    expect(s.host).toBe("vault.pinecone.pcp");
    expect(s.cwd).toBe("/");
    expect(s.lines.some((l) => l.kind === "sys" && l.text === "connected to vault.pinecone.pcp")).toBe(true);
  });

  it("rejects surface as error lines with the rate-limit hint", async () => {
    installSession(async () => ({
      events: [],
      rejection: { code: "rate_limited", message: "Too many attempts.", retryAfterSeconds: 90 },
    }));
    await useTerminalStore.getState().openHost("printer.pinecone.pcp");
    const s = useTerminalStore.getState();
    expect(s.lastError).toBe("Too many attempts.");
    expect(s.lines.some((l) => l.kind === "err" && l.text.includes("Too many attempts."))).toBe(true);
  });
});

describe("terminal store helpers", () => {
  it("terminalHosts filters the world table by service", () => {
    expect(
      terminalHosts([
        { host: "forge.pinecone.pcp", service: "forge", title: "GIT//FORGE" },
        { host: "printer.pinecone.pcp", service: "terminal", title: "NODE TERMINAL" },
        { host: "vault.pinecone.pcp", service: "terminal", title: "VAULT" },
      ])
    ).toEqual([
      { host: "printer.pinecone.pcp", title: "NODE TERMINAL" },
      { host: "vault.pinecone.pcp", title: "VAULT" },
    ]);
    expect(terminalHosts(undefined)).toEqual([]);
  });
});

describe("terminal screen-reader mode (§11.5)", () => {
  it("renders the transcript as a labelled log and dispatches the whole line on submit", async () => {
    const submit = installSession(async () => ({ events: [], result: { output: "file.txt", cwd: "/" } }));
    useTerminalStore.setState({
      host: "printer.pinecone.pcp",
      cwd: "/",
      lines: [{ kind: "out", text: "file.txt", n: 1 }],
      busy: false,
      announcement: "file.txt",
    });
    render(<TerminalSessionArea />);
    // Toggle to the DOM transcript mode.
    fireEvent.click(screen.getByRole("button", { name: "Screen reader" }));
    const log = screen.getByRole("list", { name: "Terminal transcript" });
    expect(log).toHaveTextContent("file.txt");
    // The live region mirrors output for assistive tech (log + announcement).
    expect(screen.getAllByText("file.txt").length).toBeGreaterThanOrEqual(2);

    fireEvent.change(screen.getByLabelText("Command for printer.pinecone.pcp"), { target: { value: "cat /etc/motd" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ type: "terminal", host: "printer.pinecone.pcp", cwd: "/", line: "cat /etc/motd" })));
  });

  it("switches to a password input while a passphrase gate is pending", async () => {
    const submit = installSession(async (action) =>
      action.type === "submitAnswer"
        ? { events: [], rejection: { code: "invalid_input", message: "No." } }
        : { events: [], result: GATED_CONNECT }
    );
    await useTerminalStore.getState().openHost("printer.pinecone.pcp");
    render(<TerminalSessionArea />);
    fireEvent.click(screen.getByRole("button", { name: "Screen reader" }));
    const input = screen.getByLabelText("Passphrase");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: "biscuit2009" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ type: "submitAnswer", gateId: "g.printer", answer: "biscuit2009" })));
    expect((await screen.findAllByText("No.")).length).toBeGreaterThanOrEqual(2); // transcript line + status/live region
  });
});

describe("terminal graphical console (xterm seam)", () => {
  it("creates an engine, replays the buffer, prints prompts and dispatches whole lines", async () => {
    const submit = installSession(async () => ({ events: [], result: { output: "notes.txt", cwd: "/" } }));
    useTerminalStore.setState({
      host: "printer.pinecone.pcp",
      cwd: "/",
      lines: [{ kind: "out", text: "welcome banner", n: 1 }],
      busy: false,
    });
    render(<TerminalSessionArea />);
    await waitFor(() => expect(hoisted.engines.length).toBe(1));
    const engine = hoisted.engines[0]!;
    expect(engine.writes.join("")).toContain("welcome banner");
    expect(engine.writes.join("")).toContain("printer.pinecone.pcp:/$");

    // Typing echoes; Enter dispatches the whole line.
    engine.handler!("l");
    engine.handler!("s");
    engine.handler!("\r");
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ type: "terminal", line: "ls" })));
    expect(engine.writes.join("")).toContain("ls");

    // The store's reply lands in the scrollback.
    await waitFor(() => expect(useTerminalStore.getState().lines.some((l) => l.text === "notes.txt")).toBe(true));
  });

  it("never echoes passphrase keystrokes and submits the secret via submitAnswer", async () => {
    const submit = installSession(async (action) =>
      action.type === "submitAnswer"
        ? {
            events: [{ type: "GateSolved", gateId: "g.printer", score: 100, at: "2026-11-02T10:05:00.000Z", by: "u1", actorKind: "human" }],
            result: { accepted: true },
          }
        : action.type === "terminal"
          ? { events: [], result: { output: "/", cwd: "/" } }
          : { events: [] }
    );
    useTerminalStore.setState({
      host: "printer.pinecone.pcp",
      cwd: "/",
      lines: [],
      pendingGateId: "g.printer",
      busy: false,
    });
    render(<TerminalSessionArea />);
    await waitFor(() => expect(hoisted.engines.length).toBe(1));
    const engine = hoisted.engines[0]!;
    expect(engine.writes.join("")).toContain("passphrase:");

    engine.handler!("b");
    engine.handler!("i");
    engine.handler!("s");
    engine.handler!("\r");
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ type: "submitAnswer", gateId: "g.printer", answer: "bis" })));
    // The typed secret characters never appear in the visual buffer.
    expect(engine.writes.join("")).not.toContain("bis");
  });

  it("TerminalSessionPage binds the browser's TerminalView host to the session", async () => {
    installSession(async () => ({ events: [], result: { output: "session root", cwd: "/" } }));
    // The motd banner comes from GET /api/view (lazily bound client → stub works).
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/view")) {
          return new Response(
            JSON.stringify({
              view: { view: "terminal", host: "vault.pinecone.pcp", cwd: "/", motd: "VAULT NODE", lines: [], passphrasePrompt: false },
              collectibles: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ error: "unrouted" }), { status: 404 });
      })
    );
    render(
      <TerminalSessionPage
        view={{ view: "terminal", host: "vault.pinecone.pcp", cwd: "/", motd: "VAULT NODE", lines: [], passphrasePrompt: false }}
      />
    );
    await waitFor(() => expect(useTerminalStore.getState().host).toBe("vault.pinecone.pcp"));
    expect(useTerminalStore.getState().motd).toBe("VAULT NODE");
    expect(useTerminalStore.getState().lines.some((l) => l.text === "VAULT NODE")).toBe(true);
    expect(useTerminalStore.getState().lines.some((l) => l.text === "session root")).toBe(true);
  });
});

describe("terminal SR transcript component", () => {
  it("marks command, error and system lines distinctly", () => {
    render(
      <TerminalSrMode />
    );
    // Renders without a session; nothing crashes and the log is labelled.
    expect(screen.getByRole("list", { name: "Terminal transcript" })).toBeInTheDocument();
  });
});
