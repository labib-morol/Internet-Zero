// Design tokens + component styles: apps import them with
// `@import "@iz/ui/styles.css";` (see apps/web/src/app.css).

export { PACKAGE_NAME } from "./version.js";

// Primitives
export { Button, TextInput, Panel, Card } from "./primitives.js";
export type { ButtonProps, TextInputProps } from "./primitives.js";

// Live region
export { LiveRegion, announce, useLiveStore, useExternalValue } from "./live.js";

// Safe AST renderer (§10.6)
export { SafeAst } from "./safe-ast.js";
export type { SafeAstProps } from "./safe-ast.js";

// Clock
export { WorldClock, worldClockText, formatElapsedHm, formatAbsoluteHm, useTickingText } from "./clock.js";
export type { WorldClockProps } from "./clock.js";

// Window chrome
export { Window, WINDOW_MIN_H, WINDOW_MIN_W } from "./window.js";
export type { WindowProps, WindowGeometry } from "./window.js";

// Dock
export { Dock, DockGlyph } from "./dock.js";
export type { DockApp, DockProps } from "./dock.js";

// Menu bar
export { MenuBar } from "./menubar.js";
export type { MenuBarProps, ConnectionStatus } from "./menubar.js";

// API client
export { createIzClient, ApiError } from "./api/client.js";
export type { IzClient, IzClientOptions, ViewResponse } from "./api/client.js";

// WebSocket team stream
export { TeamSocket } from "./api/ws.js";
export type { TeamSocketStatus, TeamSocketHandlers, TeamSocketOptions } from "./api/ws.js";

// Wire state
export { hydrateState, normalizeWire } from "./state/wire.js";
export type { WireRuntimeState, HydratedRuntimeState } from "./state/wire.js";

// Event merge reducer
export { applyEventsToWire, MAX_TRACKED_ATTEMPTS } from "./state/events.js";
export type { MergeContext } from "./state/events.js";

// Session store
export {
  useSessionStore,
  teamSocket,
  readStoredToken,
  setIzClientForTests,
  IZ_TOKEN_KEY,
} from "./state/session.js";
export type { SessionInfo, Screen, SessionStatus } from "./state/session.js";
