import type { ReactNode } from "react";
import { AgentConnection } from './AgentConnection.js';

/**
 * Help window content: the in-fiction field manual. Real content, no mocks.
 */
export function HelpContent(): ReactNode {
  return (
    <div className="iz-doc">
      <h1>Field manual</h1>
      <h2>Browsing</h2>
      <p>
        Type an address — <code>host/path</code> — into the browser's address bar and press Enter.
        Back, forward and bookmarks live in the toolbar; they belong to your browser window only.
      </p>
      <h2>Evidence</h2>
      <p>
        Pages offer a <strong>Collect</strong> button on collectible material. You can also select any
        text on a page and press <span className="iz-kbd">C</span> to collect the exact range you
        selected. Collected evidence appears in your case file and notebook.
      </p>
      <h2>Case file</h2>
      <p>
        The side panel tracks your score, solved gates, accepted report groups and hints. Submit
        answers and reports where the world offers them; the case file updates live.
      </p>
      <h2>Keyboard</h2>
      <ul>
        <li>
          <span className="iz-kbd">Alt</span>+<span className="iz-kbd">1</span>…<span className="iz-kbd">7</span>{" "}
          — open or focus dock apps
        </li>
        <li>Focus a window's title bar: <span className="iz-kbd">←→↑↓</span> move it, hold <span className="iz-kbd">Shift</span> to resize</li>
        <li>Under 900 px wide the desktop switches to one full-screen window with a switcher bar</li>
      </ul>
      <AgentConnection />
      <h2>Recovery</h2>
      <p>
        Guest sessions are reachable only through the recovery code shown at the start. It is displayed
        once — keep it. Lost it? Start a fresh case.
      </p>
    </div>
  );
}

/**
 * Honest placeholder for dock apps whose UIs are later M1 tasks (terminal,
 * notebook, board). Navigation and state are real; the service surfaces are
 * not built yet and this says so instead of faking them.
 */
export function NotBuiltSurface({ app, task }: { app: string; task: string }): ReactNode {
  return (
    <div className="iz-doc">
      <h1>{app}</h1>
      <p>
        The {app} surface is part of milestone 1 but is not built in this slice ({task}). The dock
        entry and window are in place so navigation already works.
      </p>
    </div>
  );
}
