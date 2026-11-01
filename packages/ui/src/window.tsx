import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/**
 * Window chrome (§11.1): draggable, resizable, focusable, minimizable.
 * Controlled component — geometry lives in the shell's window manager store;
 * this component reports changes via callbacks. Keyboard path: the title bar
 * is focusable; arrow keys move the window (16 px), shift+arrow resizes it.
 * Compact mode (under 900 px) disables drag/resize and ignores geometry.
 */

export interface WindowGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowProps {
  title: string;
  geometry: WindowGeometry;
  focused: boolean;
  /** Per-service skin class (iz-skin-forge etc.) applied to the window. */
  skin?: string;
  compact?: boolean;
  /** Accessible name; defaults to title. */
  ariaLabel?: string;
  zIndex?: number;
  onFocus?: () => void;
  onClose?: () => void;
  onMinimize?: () => void;
  onGeometryChange?: (geometry: WindowGeometry) => void;
  children: ReactNode;
}

export const WINDOW_MIN_W = 320;
export const WINDOW_MIN_H = 160;
const MOVE_STEP = 16;

interface DragState {
  kind: "move" | "resize";
  startX: number;
  startY: number;
  origin: WindowGeometry;
}

export function Window({
  title,
  geometry,
  focused,
  skin,
  compact = false,
  ariaLabel,
  zIndex,
  onFocus,
  onClose,
  onMinimize,
  onGeometryChange,
  children,
}: WindowProps): ReactNode {
  const [drag, setDrag] = useState<DragState | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const beginDrag = useCallback(
    (kind: "move" | "resize") => (event: ReactPointerEvent<HTMLElement>) => {
      if (compact || event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (kind === "move" && target.closest("button") !== null) return; // title bar buttons stay clickable
      event.preventDefault();
      onFocus?.();
      const state: DragState = { kind, startX: event.clientX, startY: event.clientY, origin: { ...geometry } };
      setDrag(state);
      // jsdom has no pointer capture; only use it where available.
      if (typeof event.currentTarget.setPointerCapture === "function") {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* pointer already released — ignore */
        }
      }
    },
    [compact, geometry, onFocus]
  );

  useEffect(() => {
    if (drag === undefined) return;
    const onMove = (event: PointerEvent): void => {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (drag.kind === "move") {
        onGeometryChange?.({
          ...geometry,
          x: drag.origin.x + dx,
          y: Math.max(0, drag.origin.y + dy),
        });
      } else {
        onGeometryChange?.({
          ...drag.origin,
          w: Math.max(WINDOW_MIN_W, drag.origin.w + dx),
          h: Math.max(WINDOW_MIN_H, drag.origin.h + dy),
        });
      }
    };
    const onUp = (): void => setDrag(undefined);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, geometry, onGeometryChange]);

  const onHeaderKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (compact) return;
    const resize = event.shiftKey;
    const step = MOVE_STEP * (resize ? 1 : 1);
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        if (resize) onGeometryChange?.({ ...geometry, w: Math.max(WINDOW_MIN_W, geometry.w - step) });
        else onGeometryChange?.({ ...geometry, x: geometry.x - step });
        break;
      case "ArrowRight":
        event.preventDefault();
        if (resize) onGeometryChange?.({ ...geometry, w: geometry.w + step });
        else onGeometryChange?.({ ...geometry, x: geometry.x + step });
        break;
      case "ArrowUp":
        event.preventDefault();
        if (resize) onGeometryChange?.({ ...geometry, h: Math.max(WINDOW_MIN_H, geometry.h - step) });
        else onGeometryChange?.({ ...geometry, y: Math.max(0, geometry.y - step) });
        break;
      case "ArrowDown":
        event.preventDefault();
        if (resize) onGeometryChange?.({ ...geometry, h: geometry.h + step });
        else onGeometryChange?.({ ...geometry, y: geometry.y + step });
        break;
      default:
        return;
    }
  };

  const style: Record<string, string | number> = compact
    ? { zIndex: zIndex ?? 0 }
    : {
        left: `${geometry.x}px`,
        top: `${geometry.y}px`,
        width: `${geometry.w}px`,
        height: `${geometry.h}px`,
        zIndex: zIndex ?? 0,
      };

  return (
    <section
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-label={ariaLabel ?? title}
      className={[
        "iz-window",
        focused ? "iz-window--focused" : "",
        compact ? "iz-window--compact" : "",
        skin ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      onPointerDown={() => onFocus?.()}
    >
      <header
        className="iz-window__head"
        tabIndex={0}
        aria-label={`${title} window. Use arrow keys to move, shift with arrow keys to resize.`}
        onKeyDown={onHeaderKeyDown}
        onPointerDown={beginDrag("move")}
        onDoubleClick={() => onMinimize?.()}
      >
        <span className="iz-window__title">{title}</span>
        <div className="iz-window__actions">
          {onMinimize !== undefined && (
            <button
              type="button"
              className="iz-window__btn"
              aria-label={`Minimize ${title}`}
              onClick={() => onMinimize()}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="1" y="7" width="8" height="2" fill="currentColor" />
              </svg>
            </button>
          )}
          {onClose !== undefined && (
            <button
              type="button"
              className="iz-window__btn"
              aria-label={`Close ${title}`}
              onClick={() => onClose()}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M1.5 1.5 8.5 8.5 M8.5 1.5 1.5 8.5" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
          )}
        </div>
      </header>
      <div className="iz-window__body">{children}</div>
      {!compact && onGeometryChange !== undefined && (
        <div
          className="iz-window__resize"
          role="separator"
          aria-label={`Resize ${title}`}
          onPointerDown={beginDrag("resize")}
        />
      )}
    </section>
  );
}
