import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Board node positions (§11.2). Presentation state ONLY — game state (which
 * evidence, claims and links exist) lives in the session store and is owned by
 * the server. Where a node sits on the canvas is a local, per-browser concern,
 * so it persists to localStorage under iz.board.v1 and never reaches dispatch.
 */

export const BOARD_STORAGE_KEY = "iz.board.v1";

export interface BoardPosition {
  x: number;
  y: number;
}

interface BoardPositionsState {
  positions: Record<string, BoardPosition>;
  setPosition(id: string, position: BoardPosition): void;
  /** Replace every position at once (auto-layout). */
  replaceAll(positions: Record<string, BoardPosition>): void;
  clear(): void;
}

export const useBoardPositions = create<BoardPositionsState>()(
  persist(
    (set, get) => ({
      positions: {},
      setPosition(id, position) {
        set({ positions: { ...get().positions, [id]: position } });
      },
      replaceAll(positions) {
        set({ positions: { ...positions } });
      },
      clear() {
        set({ positions: {} });
      },
    }),
    {
      name: BOARD_STORAGE_KEY,
      partialize: (state) => ({ positions: state.positions }),
    }
  )
)

/** Test seam: wipe persisted and in-memory positions. */
export function resetBoardPositionsForTests(): void {
  useBoardPositions.setState({ positions: {} });
  try {
    localStorage.removeItem(BOARD_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}
