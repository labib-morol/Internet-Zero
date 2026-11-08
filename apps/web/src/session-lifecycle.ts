import { useSessionStore } from "@iz/ui";
import { useBrowserStore } from "./browser/store.js";
import { useTerminalStore } from "./services/terminal/terminal-store.js";
import { resetNoteDrafts } from "./notebook/PrivateNotes.js";

/**
 * Session lifecycle wiring for presentation stores. Case content (browser
 * history, cached views, bookmarks, visited hosts, terminal scrollback and
 * host, unsaved note drafts) belongs to the session that viewed it: on
 * sign-out or expiry it is wiped, so the next guest on a shared machine starts
 * clean. Installed once at app boot (main.tsx).
 */
export function installSessionLifecycle(): () => void {
  return useSessionStore.subscribe((state, prev) => {
    if (state.session === undefined && prev.session !== undefined) {
      useBrowserStore.getState().resetSessionContent();
      useTerminalStore.getState().reset();
      resetNoteDrafts();
    }
  });
}
