import { useEffect, useRef, useState, type ReactNode } from "react";
import { LiveRegion, MenuBar, Window, announce, teamSocket, useSessionStore } from "@iz/ui";
import { BrowserWindow } from "../browser/BrowserWindow.js";
import { parseAddress, useBrowserStore } from "../browser/store.js";
import { TerminalWindow } from "../services/index.js";
import { NotebookWindow } from "../notebook/index.js";
import { BoardWindow } from "../board/index.js";
import { NetworkDirectory } from "../network/NetworkDirectory.js";
import { CaseFilePanel } from "./CaseFilePanel.js";
import { HelpContent } from "./HelpContent.js";
import { DOCK_ORDER, activateByHotkey, useWindowsStore, type AppId, type ManagedWindow } from "./windows.js";
import { Dock } from "@iz/ui";
import { RecoveryModal } from "../shared/RecoveryModal.js";

/**
 * Desktop shell (§11.1): menu bar, dock, window manager, case file panel.
 * Under 900 px: single full-screen window with a switcher bar; drag/resize
 * disabled (compact mode).
 */

export function useCompactMode(): boolean {
  const [compact, setCompact] = useState(() => typeof matchMedia === "function" && matchMedia("(max-width: 899px)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(max-width: 899px)");
    const onChange = (event: MediaQueryListEvent): void => setCompact(event.matches);
    query.addEventListener("change", onChange);
    setCompact(query.matches);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return compact;
}

function WindowSurface({ win }: { win: ManagedWindow }): ReactNode {
  switch (win.appId) {
    case "browser":
      return <BrowserWindow />;
    case "network":
      return <NetworkDirectory />;
    case "help":
      return <HelpContent />;
    case "case":
      return (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <CaseFilePanel onClose={() => useWindowsStore.getState().close(win.id)} />
        </div>
      );
    case "terminal":
      return <TerminalWindow />;
    case "notebook":
      return <NotebookWindow onOpenInBrowser={({ host, path }) => {
        useWindowsStore.getState().activate('browser');
        void useBrowserStore.getState().navigate(host, path.startsWith('/') ? path : `/${path}`);
      }} />;
    case "board":
      return <BoardWindow onOpenItem={() => useWindowsStore.getState().activate('notebook')} />;
    default:
      return <p>Unknown app.</p>;
  }
}

export function Shell(): ReactNode {
  const compact = useCompactMode();
  const sessionName = useSessionStore((s) => s.session?.displayName ?? "Guest investigator");
  const worldTitle = useSessionStore((s) => s.world?.title);
  const startedAt = useSessionStore((s) => s.state?.startedAt);
  const connection = useSessionStore((s) => s.connection);
  const pendingRecoveryCode = useSessionStore((s) => s.pendingRecoveryCode);
  const dismissRecoveryCode = useSessionStore((s) => s.dismissRecoveryCode);
  const world = useSessionStore((s) => s.world);

  const windows = useWindowsStore((s) => s.windows);
  const focusId = useWindowsStore((s) => s.focusId);
  const focus = useWindowsStore((s) => s.focus);
  const close = useWindowsStore((s) => s.close);
  const toggleMinimize = useWindowsStore((s) => s.toggleMinimize);
  const move = useWindowsStore((s) => s.move);
  const resize = useWindowsStore((s) => s.resize);
  const activate = useWindowsStore((s) => s.activate);

  const [caseOpen, setCaseOpen] = useState(false);
  const didEntryNav = useRef(false);

  // Live team stream (§12): one socket per session; REST dispatches merge the
  // same events, so the reducer's duplicate guard keeps state consistent.
  useEffect(() => {
    const token = useSessionStore.getState().session?.token;
    if (token === undefined) return;
    teamSocket.start(token);
    return () => {
      // Keep the socket alive across Shell re-renders; stop it only when the
      // session really goes away (store-driven), not on StrictMode remount.
    };
  }, []);

  // Keyboard: Alt+1..7 switches dock apps.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target !== null && target.closest("input, textarea, select") !== null) return;
      if (activateByHotkey(event.key)) event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // First entry: open the browser on the world's entry host/path (§11.3).
  useEffect(() => {
    if (didEntryNav.current || world === undefined) return;
    didEntryNav.current = true;
    const browser = useWindowsStore.getState().windows.find((w) => w.appId === "browser");
    if (browser === undefined) activate("browser");
    const parsed = parseAddress(world.entry);
    const entries = useBrowserStore.getState().entries;
    if (parsed !== undefined && entries.length === 0) {
      void useBrowserStore.getState().navigate(parsed.host, parsed.path);
    }
  }, [world, activate]);

  const onDockActivate = (appId: string): void => {
    if (appId === "case") {
      setCaseOpen((open) => !open);
      return;
    }
    activate(appId as AppId);
  };

  const openIds = new Set<string>(windows.map((w) => w.appId));
  if (caseOpen) openIds.add("case");

  const visibleWindows = compact
    ? windows.filter((w) => !w.minimized && w.id === focusId)
    : windows.filter((w) => !w.minimized);

  return (
    <div className="iz-root iz-desktop">
      <MenuBar sessionName={sessionName} worldTitle={worldTitle} startedAt={startedAt} connection={connection}>
        <button
          type="button"
          className="iz-btn iz-btn--quiet"
          aria-pressed={caseOpen}
          onClick={() => setCaseOpen((open) => !open)}
        >
          Case file
        </button>
        <button
          type="button"
          className="iz-btn iz-btn--quiet"
          onClick={() => {
            useSessionStore.getState().signOut();
            announce("Signed out. Keep your recovery code to return.");
          }}
        >
          Sign out
        </button>
      </MenuBar>

      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
        <div className="iz-desktop__windows" style={{ position: "relative", flex: 1, minWidth: 0 }}>
          {visibleWindows.map((win) => (
            <Window
              key={win.id}
              title={win.title}
              geometry={{ x: win.x, y: win.y, w: win.w, h: win.h }}
              focused={win.id === focusId}
              compact={compact}
              zIndex={win.z}
              ariaLabel={win.title}
              onFocus={() => focus(win.id)}
              onClose={() => close(win.id)}
              onMinimize={() => toggleMinimize(win.id)}
              onGeometryChange={(g) => {
                move(win.id, g.x, g.y);
                resize(win.id, g.w, g.h);
              }}
            >
              <WindowSurface win={win} />
            </Window>
          ))}
          {windows.length === 0 && (
            <div style={{ padding: 24, color: "var(--iz-faint)" }}>
              <p style={{ fontSize: 15, color: "var(--iz-dim)" }}>The desktop is quiet.</p>
              <p>Open the Browser from the dock below{compact ? "" : ""}, or press Alt+1.</p>
            </div>
          )}
        </div>
        {caseOpen && !compact && <CaseFilePanel onClose={() => setCaseOpen(false)} />}
      </div>

      {compact ? (
        <nav className="iz-switcher" aria-label="Open windows">
          {DOCK_ORDER.map((app) => (
            <button
              key={app.id}
              type="button"
              className="iz-switcher__btn"
              aria-pressed={windows.some((win) => win.appId === app.id && win.id === focusId && !win.minimized)}
              onClick={() => activate(app.id as AppId)}
            >
              {app.label}
            </button>
          ))}
          {windows.length === 0 && (
            <span style={{ color: "var(--iz-faint)", fontSize: 12.5 }}>No windows open</span>
          )}
        </nav>
      ) : (
        <Dock apps={DOCK_ORDER} openIds={openIds} onActivate={onDockActivate} />
      )}

      {pendingRecoveryCode !== undefined && (
        <RecoveryModal code={pendingRecoveryCode} onConfirm={dismissRecoveryCode} />
      )}
      <LiveRegion />
    </div>
  );
}
