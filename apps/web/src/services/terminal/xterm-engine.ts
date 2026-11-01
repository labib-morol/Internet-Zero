import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

/**
 * Thin seam over @xterm/xterm so the React components stay render-testable:
 * tests replace this module (vi.mock) and drive the component against a stub
 * engine. The engine owns NO game logic — only keystrokes and bytes.
 */

export interface TerminalEngine {
  write(text: string): void;
  clear(): void;
  fit(): void;
  focus(): void;
  dispose(): void;
  onData(callback: (data: string) => void): void;
}

/** Palette mirrors the kit tokens (ui.css) — kept literal for xterm's API. */
const THEME = {
  background: "#0a0f0c",
  foreground: "#e7ebee",
  cursor: "#85b08e",
  cursorAccent: "#0a0f0c",
  selectionBackground: "#8a6c3a",
  black: "#0a0f0c",
  green: "#85b08e",
  red: "#c4574e",
  yellow: "#c98a4b",
  blue: "#8fa9cc",
};

export function createTerminalEngine(container: HTMLElement): TerminalEngine {
  const term = new Terminal({
    fontSize: 13,
    fontFamily: 'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace',
    cursorBlink: false, // §11.4: a subtle cursor, no blink spam
    cursorStyle: "bar",
    scrollback: TERMINAL_SCROLLBACK,
    theme: THEME,
    convertEol: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container);
  requestAnimationFrame(() => fit.fit());
  return {
    write: (text) => term.write(text),
    clear: () => term.clear(),
    fit: () => {
      try {
        fit.fit();
      } catch {
        /* container not measurable yet — next resize retries */
      }
    },
    focus: () => term.focus(),
    dispose: () => term.dispose(),
    onData: (callback) => term.onData(callback),
  };
}

export const TERMINAL_SCROLLBACK = 2000;
