import "@testing-library/jest-dom/vitest";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { useState } from "react";
import { Window, type WindowGeometry } from "../src/window.js";
import { Dock } from "../src/dock.js";
import { MenuBar } from "../src/menubar.js";
import { WorldClock, formatAbsoluteHm, worldClockText } from "../src/clock.js";
import { announce, LiveRegion, useLiveStore } from "../src/live.js";

afterEach(cleanup);

function Harness({ initial, compact = false }: { initial: WindowGeometry; compact?: boolean }): React.JSX.Element {
  const [geometry, setGeometry] = useState(initial);
  return (
    <Window
      title="GIT//FORGE"
      geometry={geometry}
      focused
      skin="iz-skin-forge"
      compact={compact}
      zIndex={7}
      onFocus={() => undefined}
      onClose={() => undefined}
      onMinimize={() => undefined}
      onGeometryChange={setGeometry}
    >
      <p>repo content</p>
    </Window>
  );
}

describe("Window", () => {
  it("renders an accessible dialog with labelled controls", () => {
    render(<Harness initial={{ x: 10, y: 20, w: 640, h: 400 }} />);
    const win = screen.getByRole("dialog", { name: "GIT//FORGE" });
    expect(win).toBeInTheDocument();
    expect(win.className).toContain("iz-skin-forge");
    expect(screen.getByRole("button", { name: "Minimize GIT//FORGE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close GIT//FORGE" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize GIT//FORGE" })).toBeInTheDocument();
    expect(screen.getByText("repo content")).toBeInTheDocument();
  });

  it("applies geometry to the inline style", () => {
    render(<Harness initial={{ x: 10, y: 20, w: 640, h: 400 }} />);
    const win = screen.getByRole("dialog", { name: "GIT//FORGE" }) as HTMLElement;
    expect(win.style.left).toBe("10px");
    expect(win.style.top).toBe("20px");
    expect(win.style.width).toBe("640px");
    expect(win.style.height).toBe("400px");
    expect(win.style.zIndex).toBe("7");
  });

  it("drags via pointer events and reports the new geometry", () => {
    render(<Harness initial={{ x: 10, y: 10, w: 640, h: 400 }} />);
    const head = screen.getByRole("dialog", { name: "GIT//FORGE" }).querySelector("header")!;
    fireEvent.pointerDown(head, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 140, clientY: 130 });
    fireEvent.pointerUp(window);
    const win = screen.getByRole("dialog", { name: "GIT//FORGE" }) as HTMLElement;
    expect(win.style.left).toBe("50px");
    expect(win.style.top).toBe("40px");
  });

  it("resizes from the corner handle and clamps to the minimum size", () => {
    render(<Harness initial={{ x: 0, y: 0, w: 400, h: 300 }} />);
    const handle = screen.getByRole("separator", { name: "Resize GIT//FORGE" });
    fireEvent.pointerDown(handle, { button: 0, clientX: 400, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 100 }); // shrink far below minimum
    fireEvent.pointerUp(window);
    const win = screen.getByRole("dialog", { name: "GIT//FORGE" }) as HTMLElement;
    expect(win.style.width).toBe("320px"); // WINDOW_MIN_W
    expect(win.style.height).toBe("160px"); // WINDOW_MIN_H
  });

  it("moves with arrow keys from the focused title bar and resizes with shift", () => {
    render(<Harness initial={{ x: 100, y: 100, w: 640, h: 400 }} />);
    const head = screen.getByRole("dialog", { name: "GIT//FORGE" }).querySelector("header") as HTMLElement;
    fireEvent.keyDown(head, { key: "ArrowLeft" });
    fireEvent.keyDown(head, { key: "ArrowUp" });
    const win = screen.getByRole("dialog", { name: "GIT//FORGE" }) as HTMLElement;
    expect(win.style.left).toBe("84px");
    expect(win.style.top).toBe("84px");
    fireEvent.keyDown(head, { key: "ArrowRight", shiftKey: true });
    expect((screen.getByRole("dialog", { name: "GIT//FORGE" }) as HTMLElement).style.width).toBe("656px");
  });

  it("ignores geometry and drag in compact mode", () => {
    render(<Harness initial={{ x: 10, y: 20, w: 640, h: 400 }} compact />);
    const win = screen.getByRole("dialog", { name: "GIT//FORGE" }) as HTMLElement;
    expect(win.className).toContain("iz-window--compact");
    expect(win.style.left).toBe("");
    expect(screen.queryByRole("separator", { name: "Resize GIT//FORGE" })).toBeNull();
    const head = win.querySelector("header")!;
    fireEvent.pointerDown(head, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(window);
    expect(win.style.left).toBe(""); // never moved
  });
});

describe("Dock", () => {
  it("renders labelled buttons with open state and activates on click", () => {
    const onActivate = vi.fn();
    render(
      <Dock
        apps={[
          { id: "browser", label: "Browser" },
          { id: "case", label: "Case Reports" },
        ]}
        openIds={new Set(["browser"])}
        onActivate={onActivate}
      />
    );
    const browser = screen.getByRole("button", { name: "Browser (open)" });
    expect(browser).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Case Reports" }));
    expect(onActivate).toHaveBeenCalledWith("case");
  });
});

describe("MenuBar", () => {
  it("shows brand, session name, connection status and a labelled clock", () => {
    render(
      <MenuBar
        sessionName="Guest 1234"
        worldTitle="Lost and Found"
        startedAt={new Date(Date.now() - 90 * 60 * 1000).toISOString()}
        connection="online"
      />
    );
    expect(screen.getAllByText("INTRANET ZERO").length).toBeGreaterThan(0);
    expect(screen.getByText("Guest 1234")).toBeInTheDocument();
    expect(screen.getByText("Lost and Found")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Connection status: Connected" })).toBeInTheDocument();
    const timer = screen.getByRole("timer");
    expect(timer.getAttribute("aria-label")).toMatch(/World clock/);
  });

  it("renders children in the right meta slot", () => {
    render(
      <MenuBar sessionName="S" worldTitle="W" startedAt={undefined} connection="offline">
        <button type="button">Case file</button>
      </MenuBar>
    );
    expect(screen.getByRole("button", { name: "Case file" })).toBeInTheDocument();
  });
});

describe("WorldClock", () => {
  it("formats session-relative time when the epoch is unknown", () => {
    const now = new Date("2026-11-02T12:34:00.000Z");
    const startedAt = new Date(now.getTime() - 95 * 60 * 1000).toISOString();
    expect(worldClockText(startedAt, undefined, now)).toBe("01:35");
  });

  it("formats absolute world time when the epoch is known", () => {
    const now = new Date("2026-11-02T12:34:00.000Z");
    const startedAt = new Date(now.getTime() - 60_000).toISOString();
    const epoch = Date.parse("2026-11-02T00:00:00.000Z");
    // The absolute rendering uses the host's local timezone; compare against
    // the same formatting applied to the expected instant.
    expect(worldClockText(startedAt, epoch, now)).toBe(formatAbsoluteHm(new Date(epoch + 60_000)));
  });

  it("falls back to the wall clock without a valid startedAt", () => {
    expect(worldClockText(undefined, undefined, new Date("2026-11-02T09:05:00"))).toBe("09:05");
  });

  it("renders ticking text with the injected now()", () => {
    const tick = 0;
    render(<WorldClock startedAt="2026-11-02T10:00:00.000Z" now={() => new Date(Date.parse("2026-11-02T10:0" + tick + ":00Z"))} />);
    expect(screen.getByRole("timer").textContent).toBe("00:00");
  });
});

describe("LiveRegion", () => {
  afterEach(() => {
    useLiveStore.setState({ polite: undefined, assertive: undefined });
  });

  it("announces polite and assertive messages", async () => {
    render(<LiveRegion />);
    const polite = screen.getByRole("status");
    act(() => announce("Evidence collected."));
    expect(polite.textContent).toBe("Evidence collected.");
    act(() => announce("Rejected.", true));
    expect(screen.getByRole("alert").textContent).toBe("Rejected.");
  });

  it("re-announces the same text via the nonce", () => {
    render(<LiveRegion />);
    act(() => announce("ping"));
    const first = useLiveStore.getState().polite?.nonce ?? 0;
    act(() => announce("ping"));
    expect((useLiveStore.getState().polite?.nonce ?? 0)).toBe(first + 1);
  });
});
