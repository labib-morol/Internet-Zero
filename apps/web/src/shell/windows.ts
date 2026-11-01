import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Window manager (§11.1): open/close/focus/minimize/move/resize with z-order
 * and localStorage persistence per session. Dock apps are singletons (one
 * window per app). Alt+1..7 switching and the under-900px compact mode are
 * handled by the shell; this store is mode-agnostic.
 */

export type AppId = "browser" | "terminal" | "notebook" | "board" | "network" | "case" | "help";

export interface ManagedWindow {
  id: string;
  appId: AppId;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
}

interface WindowsState {
  windows: ManagedWindow[];
  focusId: string | null;
  topZ: number;
  open(appId: AppId, title?: string): void;
  close(id: string): void;
  focus(id: string): void;
  toggleMinimize(id: string): void;
  move(id: string, x: number, y: number): void;
  resize(id: string, w: number, h: number): void;
  /** Open-or-focus the app's singleton window; returns whether it was opened. */
  activate(appId: AppId, title?: string): void;
}

export const WINDOW_MANAGER_KEY = "iz.windows.v1";

/** Dock order (§11.1) — also the Alt+1..7 mapping. */
export const DOCK_ORDER: Array<{ id: AppId; label: string }> = [
  { id: "browser", label: "Browser" },
  { id: "terminal", label: "Terminal" },
  { id: "notebook", label: "Notebook" },
  { id: "board", label: "Board" },
  { id: "network", label: "Network" },
  { id: "case", label: "Case Reports" },
  { id: "help", label: "Help" },
];

const DEFAULT_GEOMETRY: Record<AppId, { w: number; h: number }> = {
  browser: { w: 780, h: 560 },
  terminal: { w: 640, h: 420 },
  notebook: { w: 560, h: 460 },
  board: { w: 720, h: 520 },
  network: { w: 460, h: 420 },
  case: { w: 420, h: 480 },
  help: { w: 560, h: 460 },
};

let seq = 0;
function nextId(appId: AppId): string {
  seq += 1;
  return `${appId}-${Date.now().toString(36)}-${seq}`;
}

export const useWindowsStore = create<WindowsState>()(
  persist(
    (set, get) => ({
      windows: [],
      focusId: null,
      topZ: 10,

      open(appId, title) {
        const { windows, topZ } = get();
        const id = nextId(appId);
        const count = windows.length;
        const geom = DEFAULT_GEOMETRY[appId];
        const win: ManagedWindow = {
          id,
          appId,
          title: title ?? DOCK_ORDER.find((a) => a.id === appId)?.label ?? appId,
          // Cascade new windows slightly so they never perfectly overlap.
          x: 60 + ((count * 28) % 180),
          y: 40 + ((count * 24) % 120),
          w: geom.w,
          h: geom.h,
          z: topZ + 1,
          minimized: false,
        };
        set({ windows: [...windows, win], focusId: id, topZ: topZ + 1 });
      },

      close(id) {
        const windows = get().windows.filter((w) => w.id !== id);
        const focusId =
          get().focusId === id
            ? (windows.filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0]?.id ?? null)
            : get().focusId;
        set({ windows, focusId });
      },

      focus(id) {
        const { windows, topZ, focusId } = get();
        if (focusId === id) return;
        const win = windows.find((w) => w.id === id);
        if (win === undefined) return;
        const nextTop = topZ + 1;
        set({
          windows: windows.map((w) => (w.id === id ? { ...w, z: nextTop, minimized: false } : w)),
          focusId: id,
          topZ: nextTop,
        });
      },

      toggleMinimize(id) {
        const { windows, focusId } = get();
        const win = windows.find((w) => w.id === id);
        if (win === undefined) return;
        const minimized = !win.minimized;
        const visible = windows.filter((w) => w.id !== id && !w.minimized).sort((a, b) => b.z - a.z);
        set({
          windows: windows.map((w) => (w.id === id ? { ...w, minimized } : w)),
          focusId: minimized && focusId === id ? (visible[0]?.id ?? null) : focusId,
        });
      },

      move(id, x, y) {
        set({
          windows: get().windows.map((w) =>
            w.id === id ? { ...w, x, y: Math.max(0, y) } : w
          ),
        });
      },

      resize(id, w, h) {
        set({
          windows: get().windows.map((win) =>
            win.id === id ? { ...win, w: Math.max(320, w), h: Math.max(160, h) } : win
          ),
        });
      },

      activate(appId, title) {
        const existing = get().windows.find((w) => w.appId === appId);
        if (existing !== undefined) {
          get().focus(existing.id);
          return;
        }
        get().open(appId, title);
      },
    }),
    {
      name: WINDOW_MANAGER_KEY,
      partialize: (state) => ({ windows: state.windows, focusId: state.focusId, topZ: state.topZ }),
    }
  )
);

/** Alt+N activates the Nth dock app (1-based). Returns true when handled. */
export function activateByHotkey(key: string): boolean {
  const index = Number.parseInt(key, 10) - 1;
  const app = DOCK_ORDER[index];
  if (app === undefined || Number.isNaN(index)) return false;
  useWindowsStore.getState().activate(app.id);
  return true;
}
