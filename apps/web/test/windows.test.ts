import { beforeEach, describe, expect, it } from "vitest";
import { activateByHotkey, DOCK_ORDER, useWindowsStore, WINDOW_MANAGER_KEY } from "../src/shell/windows.js";

function reset(): void {
  localStorage.clear();
  useWindowsStore.setState({ windows: [], focusId: null, topZ: 10 });
}

beforeEach(reset);

describe("window manager", () => {
  it("opens a window, focuses it and stacks z-order", () => {
    const { open, focus } = useWindowsStore.getState();
    open("browser");
    open("network");
    const state = useWindowsStore.getState();
    expect(state.windows).toHaveLength(2);
    expect(state.focusId).toBe(state.windows[1]?.id);
    const browser = state.windows[0]!;
    focus(browser.id);
    expect(useWindowsStore.getState().focusId).toBe(browser.id);
    const browserAfter = useWindowsStore.getState().windows[0]!;
    expect(browserAfter.z).toBeGreaterThan(state.windows[1]!.z);
  });

  it("keeps dock apps singleton via activate", () => {
    const { activate } = useWindowsStore.getState();
    activate("browser");
    activate("browser");
    expect(useWindowsStore.getState().windows).toHaveLength(1);
  });

  it("minimize toggles and moves focus to the next visible window", () => {
    const { open, toggleMinimize } = useWindowsStore.getState();
    open("browser");
    open("help");
    const [, help] = useWindowsStore.getState().windows;
    toggleMinimize(help!.id);
    const after = useWindowsStore.getState();
    expect(after.windows[1]?.minimized).toBe(true);
    expect(after.focusId).toBe(after.windows[0]?.id);
    toggleMinimize(help!.id);
    expect(useWindowsStore.getState().windows[1]?.minimized).toBe(false);
  });

  it("closes a window and refocuses the topmost remaining window", () => {
    const { open, close } = useWindowsStore.getState();
    open("browser");
    open("network");
    const [, network] = useWindowsStore.getState().windows;
    close(network!.id);
    const after = useWindowsStore.getState();
    expect(after.windows).toHaveLength(1);
    expect(after.focusId).toBe(after.windows[0]?.id);
  });

  it("clamps move and resize to sane bounds", () => {
    const { open, move, resize } = useWindowsStore.getState();
    open("browser");
    const win = useWindowsStore.getState().windows[0]!;
    move(win.id, -50, -50);
    const moved = useWindowsStore.getState().windows[0]!;
    expect(moved.x).toBe(-50);
    expect(moved.y).toBe(0); // y never negative
    resize(win.id, 10, 10);
    const resized = useWindowsStore.getState().windows[0]!;
    expect(resized.w).toBe(320);
    expect(resized.h).toBe(160);
  });

  it("maps Alt+1..7 to dock apps in order", () => {
    expect(activateByHotkey("0")).toBe(false);
    expect(activateByHotkey("8")).toBe(false);
    expect(activateByHotkey("1")).toBe(true);
    expect(activateByHotkey("5")).toBe(true);
    const windows = useWindowsStore.getState().windows;
    expect(windows.map((w) => w.appId)).toEqual([DOCK_ORDER[0]!.id, DOCK_ORDER[4]!.id]);
  });

  it("persists windows to localStorage under the manager key", () => {
    useWindowsStore.getState().open("browser");
    const raw = localStorage.getItem(WINDOW_MANAGER_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { state: { windows: unknown[] } };
    expect(parsed.state.windows).toHaveLength(1);
  });
});
