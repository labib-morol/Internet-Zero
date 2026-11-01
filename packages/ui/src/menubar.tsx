import type { ReactNode } from "react";
import { WorldClock } from "./clock.js";

/**
 * Menu bar (§11.1): brand, session name, world title, world clock, connection
 * status and a right-hand slot for shell controls (case file toggle etc.).
 */

export type ConnectionStatus = "online" | "connecting" | "offline";

export interface MenuBarProps {
  brand?: string;
  sessionName: string | undefined;
  worldTitle: string | undefined;
  /** startedAt ISO from team state. */
  startedAt: string | undefined;
  /** Optional world epoch (ms) — renders absolute world time when known. */
  epochMs?: number;
  connection: ConnectionStatus;
  children?: ReactNode;
}

const CONNECTION_TEXT: Record<ConnectionStatus, string> = {
  online: "Connected",
  connecting: "Connecting…",
  offline: "Offline",
};

export function MenuBar({
  brand = "INTRANET ZERO",
  sessionName,
  worldTitle,
  startedAt,
  epochMs,
  connection,
  children,
}: MenuBarProps): ReactNode {
  return (
    <header className="iz-menubar">
      <span className="iz-menubar__brand">{brand}</span>
      {sessionName !== undefined && <span className="iz-menubar__meta">{sessionName}</span>}
      {worldTitle !== undefined && <span className="iz-menubar__meta">{worldTitle}</span>}
      <span className="iz-menubar__spacer" />
      <div className="iz-menubar__meta">
        {children}
        <WorldClock startedAt={startedAt} epochMs={epochMs} />
        <span
          className={`iz-status-dot iz-status-dot--${connection}`}
          role="img"
          aria-label={`Connection status: ${CONNECTION_TEXT[connection]}`}
          title={CONNECTION_TEXT[connection]}
        />
      </div>
    </header>
  );
}
