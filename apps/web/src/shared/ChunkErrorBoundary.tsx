import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Chunk-level error boundary: a failed dynamic import (deploy invalidated the
 * old hashed chunk, transient network hiccup) must kill ONE window, not the
 * whole desktop. React caches lazy rejections, so recovery offers a real
 * reload instead of a silent retry loop.
 */
interface BoundaryState {
  failed: boolean;
}

export class ChunkErrorBoundary extends Component<{ label: string; children: ReactNode }, BoundaryState> {
  constructor(props: { label: string; children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  // React reads this static opt-in; it is not a base-class member (no override).
  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Console only: this is a client render failure, not a server event.
    console.error(`[ui] ${this.props.label} failed to load:`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div role="alert" style={{ padding: 12, color: "var(--iz-dim)" }}>
          <p>The {this.props.label} could not be loaded.</p>
          <button type="button" className="iz-btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
