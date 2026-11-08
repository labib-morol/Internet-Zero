import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useTerminalStore, type TerminalBufferLine } from "./terminal-store.js";
import { createTerminalEngine, type TerminalEngine } from "./xterm-engine.js";

/**
 * NODE TERMINAL rendering (§10.5, §11.5). Two presentation paths over ONE
 * shared session store:
 *  - TerminalConsole: xterm.js view; keystrokes are edited locally and the
 *    WHOLE line is dispatched on Enter — nothing is evaluated client-side.
 *  - TerminalSrMode: DOM transcript + real input for screen-reader users.
 * A visually-hidden aria-live region announces new output in both modes.
 */

const ANSI = {
  reset: "\x1b[0m",
  cmd: "\x1b[1m\x1b[38;2;133;176;142m", // kit accent green, bold
  err: "\x1b[38;2;196;87;78m",
  sys: "\x1b[2m",
};

function ansiFor(line: TerminalBufferLine): string {
  switch (line.kind) {
    case "cmd":
      return ANSI.cmd;
    case "err":
      return ANSI.err;
    case "sys":
      return ANSI.sys;
    default:
      return "";
  }
}

function lineText(line: TerminalBufferLine): string {
  return line.text;
}

export function TerminalSessionArea(): ReactNode {
  const host = useTerminalStore((s) => s.host);
  const cwd = useTerminalStore((s) => s.cwd);
  const busy = useTerminalStore((s) => s.busy);
  const lastError = useTerminalStore((s) => s.lastError);
  const announcement = useTerminalStore((s) => s.announcement);
  const lines = useTerminalStore((s) => s.lines);
  const pendingGateId = useTerminalStore((s) => s.pendingGateId);
  const clearBuffer = useTerminalStore((s) => s.clearBuffer);
  const [srMode, setSrMode] = useState(false);

  if (host === undefined) return null;

  return (
    <div className="iz-term">
      <div className="iz-term__status">
        <span aria-hidden="true">▮</span>
        <span>
          {host}:{cwd}
          {pendingGateId !== undefined && " · passphrase required"}
          {busy && " · …"}
        </span>
        {lastError !== undefined && (
          <span style={{ color: "var(--iz-bad)" }} role="status">
            {lastError}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="iz-toolbar__btn" aria-pressed={srMode} onClick={() => setSrMode(!srMode)}>
          {srMode ? "Graphics" : "Screen reader"}
        </button>
        <button type="button" className="iz-toolbar__btn" onClick={clearBuffer}>
          Clear
        </button>
      </div>
      {/* §11.5: output reaches screen readers as a live region even in the
          graphical mode — this announces every new output chunk. */}
      <div className="iz-term__live" aria-live="polite">
        {announcement ?? ""}
      </div>
      {srMode ? <TerminalSrMode /> : <TerminalConsole lines={lines} />}
      <span className="iz-visually-hidden">{lines.length} lines in buffer</span>
    </div>
  );
}

/* ------------------------------ Graphical mode ---------------------------- */

export interface TerminalSyncPlan {
  /** Wipe the engine before writing (buffer was cleared/shrunk). */
  clear: boolean;
  /** Lines the engine has not written yet, oldest first. */
  write: TerminalBufferLine[];
  /** The id the engine is caught up to after applying this plan. */
  lastN: number;
}

/**
 * Decides what the graphical engine must write given the highest line id it
 * already rendered. Identity-based: index arithmetic goes blind when Clear
 * shrinks the buffer or the 500-line cap rolls old lines off, which used to
 * make all new output invisible until the window was reopened.
 */
export function planTerminalSync(lastN: number, lines: readonly TerminalBufferLine[]): TerminalSyncPlan {
  if (lines.length === 0) {
    return lastN > 0 ? { clear: true, write: [], lastN: 0 } : { clear: false, write: [], lastN: 0 };
  }
  const newest = lines[lines.length - 1]!;
  if (newest.n < lastN) {
    // Engine is ahead of the buffer (shrunk without emptying): rebuild.
    return { clear: true, write: [...lines], lastN: newest.n };
  }
  return { clear: false, write: lines.filter((line) => line.n > lastN), lastN: newest.n };
}

function TerminalConsole({ lines }: { lines: TerminalBufferLine[] }): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<TerminalEngine | null>(null);
  const writtenRef = useRef(0);
  const inputRef = useRef("");
  const promptKeyRef = useRef("init");

  const writePrompt = (key: string, text: string, leadingNewline: boolean): void => {
    const engine = engineRef.current;
    if (engine === null) return;
    engine.write(`${leadingNewline ? "\r\n" : ""}${text}`);
    promptKeyRef.current = key;
  };

  // Engine lifecycle. The keystroke handler is registered once and reads all
  // mutable state through refs + store.getState(), so it never goes stale.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const engine = createTerminalEngine(container);
    engineRef.current = engine;
    // Replay the buffer built before this mount (e.g. session started in the
    // browser page, window opened afterwards). The buffer is append-ordered,
    // so the last line carries the highest id.
    const existing = useTerminalStore.getState().lines;
    for (const line of existing) {
      engine.write(`${ansiFor(line)}${lineText(line)}${ANSI.reset}\n`);
    }
    writtenRef.current = existing.length > 0 ? existing[existing.length - 1]!.n : 0;

    // Whole-line dispatch on Enter; printable keys echo locally, never executed.
    const handleData = (data: string): void => {
      const gated = useTerminalStore.getState().pendingGateId !== undefined;
      for (const ch of data) {
        if (ch === "\r") {
          engine.write("\r\n");
          const line = inputRef.current;
          inputRef.current = "";
          promptKeyRef.current = "busy";
          void useTerminalStore.getState().submitLine(line);
        } else if (ch === "\x7f") {
          if (inputRef.current.length > 0) {
            inputRef.current = inputRef.current.slice(0, -1);
            if (!gated) engine.write("\b \b");
          }
        } else if (ch === "\u0003") {
          engine.write("^C\r\n");
          inputRef.current = "";
        } else if (ch >= " ") {
          inputRef.current += ch;
          if (!gated) engine.write(ch); // passphrase input is never echoed
        }
      }
    };
    engine.onData(handleData);

    const onResize = (): void => engine.fit();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      engine.dispose();
      engineRef.current = null;
      promptKeyRef.current = "init";
    };
  }, []);

  // New scrollback lines → xterm, tracked by line id (never by index).
  useEffect(() => {
    const engine = engineRef.current;
    if (engine === null) return;
    const plan = planTerminalSync(writtenRef.current, lines);
    if (plan.clear) engine.clear();
    for (const line of plan.write) {
      engine.write(`${ansiFor(line)}${lineText(line)}${ANSI.reset}\n`);
    }
    writtenRef.current = plan.lastN;
  }, [lines]);

  // The terminal fits its container, which resizes with the desktop window
  // (drag/resize/minimize) — not just with the browser viewport.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => engineRef.current?.fit());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Prompt: written whenever the awaiting-input state changes. The key flips
  // to "busy" while a dispatch is in flight, so a failed passphrase attempt
  // re-prints the prompt (busy → gate again).
  useEffect(() => {
    const state = useTerminalStore.getState();
    const key =
      state.busy === true
        ? "busy"
        : state.pendingGateId !== undefined
          ? "gate"
          : `cmd:${state.host ?? ""}:${state.cwd}`;
    if (key === promptKeyRef.current) return;
    if (key === "busy") {
      promptKeyRef.current = "busy";
      return;
    }
    const first = promptKeyRef.current === "init";
    if (state.pendingGateId !== undefined) {
      writePrompt(key, "passphrase: ", !first);
    } else if (state.host !== undefined) {
      writePrompt(key, `${state.host}:${state.cwd}$ `, !first);
    }
  });

  // Discard half-typed input when a passphrase prompt appears (the server took
  // over the flow: the next line IS the secret).
  const pendingGateId = useTerminalStore((s) => s.pendingGateId);
  useEffect(() => {
    if (pendingGateId !== undefined) inputRef.current = "";
  }, [pendingGateId]);

  useEffect(() => {
    const engine = engineRef.current;
    if (engine !== null) engine.focus();
  }, []);

  return (
    <div className="iz-term__screen">
      <div
        ref={containerRef}
        role="application"
        aria-label="Node terminal. Type a command and press Enter; output is announced to screen readers."
        style={{ height: "100%", minHeight: 120 }}
      />
    </div>
  );
}

/* --------------------------- Screen-reader mode --------------------------- */

export function TerminalSrMode(): ReactNode {
  const lines = useTerminalStore((s) => s.lines);
  const pendingGateId = useTerminalStore((s) => s.pendingGateId);
  const host = useTerminalStore((s) => s.host);
  const cwd = useTerminalStore((s) => s.cwd);
  const busy = useTerminalStore((s) => s.busy);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = value;
    if (trimmed === "" || busy) return;
    setValue("");
    void useTerminalStore.getState().submitLine(trimmed);
  };

  // Enter on the passphrase input goes through the same whole-line path.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") setValue("");
  };

  return (
    <div className="iz-term__sr">
      <ol className="iz-term__srlog" aria-label="Terminal transcript">
        {lines.map((line, i) => (
          <li key={i} className={`iz-term__l iz-term__l--${line.kind}`} style={{ listStyle: "none" }}>
            {line.kind === "cmd" ? `› ${line.text}` : line.text}
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="iz-term__srrow">
        <span className="iz-term__prompt" aria-hidden="true">
          {pendingGateId !== undefined ? "passphrase:" : `${host ?? ""}:${cwd}$`}
        </span>
        <input
          ref={inputRef}
          className="iz-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          type={pendingGateId !== undefined ? "password" : "text"}
          aria-label={pendingGateId !== undefined ? "Passphrase" : `Command for ${host ?? "terminal"}`}
          autoComplete="off"
          spellCheck={false}
          disabled={busy || host === undefined}
        />
        <button type="submit" className="iz-btn" disabled={busy || host === undefined}>
          Run
        </button>
      </form>
    </div>
  );
}
