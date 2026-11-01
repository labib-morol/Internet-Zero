import { useEffect, type ReactNode } from "react";
import type { TerminalView } from "@iz/schema";
import { useSessionStore } from "@iz/ui";
import { terminalHosts, useTerminalStore } from "./terminal-store.js";
import { TerminalSessionArea } from "./TerminalConsole.js";

/**
 * NODE TERMINAL window surface (M1 task 7). The dock's Terminal app shows a
 * host picker (terminal-service hosts from the world table, DECISIONS D20)
 * and then the shared session area. Also exposes TerminalSessionPage, which
 * binds the same session to a TerminalView rendered inside the in-game
 * browser — one session store, two mounts.
 */

export function TerminalWindow(): ReactNode {
  const host = useTerminalStore((s) => s.host);
  const world = useSessionStore((s) => s.world);

  if (host === undefined) {
    return <TerminalHostPicker hosts={terminalHosts(world?.hosts)} onPick={(h) => void useTerminalStore.getState().openHost(h)} />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <TerminalSessionArea />
      <div className="iz-toolbar" role="toolbar" aria-label="Terminal session controls">
        <button
          type="button"
          className="iz-toolbar__btn"
          onClick={() => useTerminalStore.getState().reset()}
        >
          Disconnect
        </button>
        <span style={{ color: "var(--iz-faint)", fontSize: 11.5 }}>
          Commands run on the world&apos;s servers; this window only displays output.
        </span>
      </div>
    </div>
  );
}

export function TerminalHostPicker({ hosts, onPick }: {
  hosts: Array<{ host: string; title: string }>;
  onPick: (host: string) => void;
}): ReactNode {
  return (
    <div className="iz-term__hostpicker">
      <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>NODE TERMINAL</h2>
      <p style={{ color: "var(--iz-dim)", fontSize: 13, margin: "0 0 14px" }}>
        Pick a host to open a session. Whole lines are sent to the world&apos;s server; the passphrase
        (when asked) unlocks the host&apos;s gate.
      </p>
      {hosts.length === 0 && (
        <p style={{ color: "var(--iz-faint)", fontSize: 12.5 }}>No terminal hosts are listed for this world yet.</p>
      )}
      <div role="list" aria-label="Terminal hosts">
        {hosts.map((h) => (
          <button key={h.host} type="button" role="listitem" className="iz-term__hostbtn" onClick={() => onPick(h.host)}>
            <span className="iz-term__hostname">{h.title}</span>
            <span className="iz-term__hostmeta">{h.host}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Session bound to a terminal view rendered inside the in-game browser. */
export function TerminalSessionPage({ view }: { view: TerminalView }): ReactNode {
  const host = useTerminalStore((s) => s.host);

  useEffect(() => {
    if (useTerminalStore.getState().host !== view.host && !useTerminalStore.getState().busy) {
      void useTerminalStore.getState().openHost(view.host);
    }
  }, [view.host]);

  if (host !== view.host) {
    return (
      <div className="iz-doc">
        <p style={{ color: "var(--iz-faint)" }}>Opening session on {view.host}…</p>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <TerminalSessionArea />
    </div>
  );
}
