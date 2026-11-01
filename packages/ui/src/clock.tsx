import { useEffect, useState, type ReactNode } from "react";

/**
 * World clock (§11.1, §13). World time = epoch + (now - session.startedAt).
 * The epoch constant is part of the world bundle, which the server never
 * sends to clients — so tonight the clock renders SESSION-RELATIVE time:
 * elapsed since startedAt, formatted HH:MM, in a labelled mono chip. When the
 * client does learn the epoch (e.g. a future API addition), pass it and the
 * same chip renders true world time.
 */

export interface WorldClockProps {
  /** ISO start time of the session (state.startedAt). */
  startedAt: string | undefined;
  /** Optional world epoch in ms; when known, renders absolute world time. */
  epochMs?: number;
  /** Injected time source for tests; defaults to wall clock. */
  now?: () => Date;
  /** Label shown to assistive tech; the chip also carries a title. */
  label?: string;
}

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** HH:MM from elapsed ms; hours may exceed 23 for long sessions. */
export function formatElapsedHm(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${two(hours)}:${two(minutes)}`;
}

/** HH:MM of an absolute timestamp in the host's local time. */
export function formatAbsoluteHm(date: Date): string {
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function worldClockText(startedAt: string | undefined, epochMs: number | undefined, now: Date): string {
  if (startedAt !== undefined) {
    const startMs = Date.parse(startedAt);
    if (!Number.isNaN(startMs)) {
      if (epochMs !== undefined) {
        // True world time: epoch + elapsed.
        return formatAbsoluteHm(new Date(epochMs + Math.max(0, now.getTime() - startMs)));
      }
      return formatElapsedHm(now.getTime() - startMs);
    }
  }
  return formatAbsoluteHm(now);
}

/** Ticking time text; re-renders every `intervalMs` (default 5s). */
export function useTickingText(compute: (now: Date) => string, intervalMs = 5000, now: () => Date = () => new Date()): string {
  const [text, setText] = useState(() => compute(now()));
  useEffect(() => {
    setText(compute(now()));
    const handle = window.setInterval(() => setText(compute(now())), intervalMs);
    return () => window.clearInterval(handle);
    // Recompute when the interval or the time source changes; callers pass
    // stable functions (or intentionally fresh ones) for compute/now.
  }, [intervalMs, compute, now]);
  return text;
}

export function WorldClock({ startedAt, epochMs, now = () => new Date(), label = "World clock" }: WorldClockProps): ReactNode {
  const text = useTickingText((t) => worldClockText(startedAt, epochMs, t), 5000, now);
  const title =
    epochMs !== undefined
      ? `${label} (world time)`
      : `${label} (session-relative; world epoch unknown to the client)`;
  return (
    <time className="iz-clock-chip" role="timer" aria-label={title} title={title}>
      {text}
    </time>
  );
}
