/**
 * Service UI surfaces (M1 tasks 4–8). Window-manager wiring is the
 * integrator's job; the exports here are the surfaces to wire:
 *
 * - TerminalWindow       → dock "Terminal" app (was NotBuiltSurface, M1 task 7)
 * - TerminalSessionPage  → alternative: bind the terminal session to the
 *                          in-game browser's TerminalView (used by ViewRenderer)
 * - ForgePage / MailPage / ArchivePage → service page renderers (already
 *                          dispatched from apps/web/src/browser/ViewRenderer.tsx)
 */

export { ForgePage, type ForgePageProps } from "./forge/ForgeViews.js";
export { unifiedDiff, wholeFileDiff, type DiffHunk, type DiffLine } from "./forge/diff.js";
export { MailPage, type MailPageProps } from "./mail/MailViews.js";
export { ArchivePage, type ArchivePageProps } from "./archive/ArchiveViews.js";
export { TerminalWindow, TerminalSessionPage, TerminalHostPicker } from "./terminal/TerminalWindow.js";
export { TerminalSessionArea } from "./terminal/TerminalConsole.js";
export {
  useTerminalStore,
  terminalHosts,
  TERMINAL_BUFFER_CAP,
  type TerminalBufferLine,
  type TerminalLineKind,
} from "./terminal/terminal-store.js";
export { fetchCaseFile } from "./case/case-api.js";
export {
  GameLink,
  CollectButton,
  IdentityChip,
  ServiceFrame,
  openInGameLink,
  shortDate,
  EmptyNote,
} from "./shared/chrome.js";
