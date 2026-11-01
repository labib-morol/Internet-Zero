import { create } from "zustand";
import { useSyncExternalStore, type ReactNode } from "react";

/**
 * ARIA live region helper (§11.5): one global polite region (and one
 * assertive) mounted once by the shell; any component can announce()
 * screen-reader notifications (collect confirmations, rejections, connection
 * changes, terminal output later).
 */

interface LiveState {
  polite: { text: string; nonce: number } | undefined;
  assertive: { text: string; nonce: number } | undefined;
}

interface LiveActions {
  announce: (text: string, assertive?: boolean) => void;
}

let nonce = 0;

export const useLiveStore = create<LiveState & LiveActions>((set) => ({
  polite: undefined,
  assertive: undefined,
  announce: (text, assertive = false) => {
    nonce += 1;
    const entry = { text, nonce };
    if (assertive) set({ assertive: entry });
    else set({ polite: entry });
  },
}));

/** Announce a message to screen readers via the global live region. */
export function announce(text: string, assertive = false): void {
  useLiveStore.getState().announce(text, assertive);
}

/**
 * Renders the two live regions. Incrementing a nonce on each announcement
 * re-triggers even when the message text repeats.
 */
export function LiveRegion(): ReactNode {
  const polite = useLiveStore((s) => s.polite);
  const assertive = useLiveStore((s) => s.assertive);
  return (
    <>
      <div aria-live="polite" role="status" className="iz-visually-hidden">
        {polite?.text}
      </div>
      <div aria-live="assertive" role="alert" className="iz-visually-hidden">
        {assertive?.text}
      </div>
    </>
  );
}

/**
 * Subscribe to an external store (used by non-React plumbing such as the
 * WebSocket client to push notifications into React). Small helper so callers
 * do not hand-roll useSyncExternalStore.
 */
export function useExternalValue<T>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => T): T {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
