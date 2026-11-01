import type { ReactNode } from "react";

/**
 * The dock (§11.1): Browser, Terminal, Notebook, Board, Network, Case Reports,
 * Help. Purely presentational — the shell maps activations to windows/panels.
 * Icons are minimal line glyphs (no emoji, no clichés).
 */

export interface DockApp {
  id: string;
  label: string;
}

export interface DockProps {
  apps: DockApp[];
  /** App ids currently open (used for the active marker). */
  openIds: ReadonlySet<string>;
  onActivate: (appId: string) => void;
}

export function Dock({ apps, openIds, onActivate }: DockProps): ReactNode {
  return (
    <nav className="iz-dock-wrap" aria-label="Dock">
      <ul className="iz-dock" style={{ listStyle: "none", margin: 0 }}>
        {apps.map((app) => (
          <li key={app.id}>
            <button
              type="button"
              className="iz-dock__btn"
              aria-pressed={openIds.has(app.id)}
              aria-label={`${app.label}${openIds.has(app.id) ? " (open)" : ""}`}
              onClick={() => onActivate(app.id)}
            >
              <DockGlyph id={app.id} />
              {app.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function DockGlyph({ id }: { id: string }): ReactNode {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    "aria-hidden": true as const,
  };
  switch (id) {
    case "browser":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="7.5" />
          <ellipse cx="10" cy="10" rx="3.4" ry="7.5" />
          <path d="M2.8 7.5h14.4M2.8 12.5h14.4" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...common}>
          <rect x="2" y="3.5" width="16" height="13" rx="1.5" />
          <path d="M5 8l2.6 2.4L5 12.8M9.5 13h5" />
        </svg>
      );
    case "notebook":
      return (
        <svg {...common}>
          <rect x="4" y="2.5" width="12" height="15" rx="1.5" />
          <path d="M7 6.5h6M7 9.5h6M7 12.5h4" />
        </svg>
      );
    case "board":
      return (
        <svg {...common}>
          <circle cx="5.5" cy="5.5" r="2.2" />
          <circle cx="14.5" cy="5.5" r="2.2" />
          <circle cx="10" cy="14.5" r="2.2" />
          <path d="M7 7l2.2 5.4M13 7l-2.2 5.4M7.7 5.5h4.6" />
        </svg>
      );
    case "network":
      return (
        <svg {...common}>
          <circle cx="10" cy="4" r="2" />
          <circle cx="4" cy="15" r="2" />
          <circle cx="16" cy="15" r="2" />
          <path d="M9 5.8 5 13.2M11 5.8l4 7.4M6 15h8" />
        </svg>
      );
    case "case":
      return (
        <svg {...common}>
          <rect x="2.5" y="6" width="15" height="10.5" rx="1.5" />
          <path d="M7.5 6V4.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V6M2.5 10.5h15" />
        </svg>
      );
    case "help":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="7.5" />
          <path d="M7.8 7.8a2.2 2.2 0 1 1 3 2.05c-.7.28-.8.75-.8 1.65" />
          <circle cx="10" cy="14" r="0.4" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="3" y="3" width="14" height="14" rx="2" />
        </svg>
      );
  }
}
