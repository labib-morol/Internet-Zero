import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChunkErrorBoundary } from "../src/shared/ChunkErrorBoundary.js";

/** Review finding 1: a failed lazy chunk kills one window, not the desktop. */

function Bomb(): never {
  throw new Error("chunk load failed");
}

describe("ChunkErrorBoundary", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a labelled fallback with a real reload affordance instead of crashing", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ChunkErrorBoundary label="evidence board">
        <Bomb />
      </ChunkErrorBoundary>
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/evidence board could not be loaded/i);
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("renders children untouched while they work", () => {
    render(<ChunkErrorBoundary label="terminal">all good</ChunkErrorBoundary>);
    expect(screen.getByText("all good")).toBeInTheDocument();
  });
});
