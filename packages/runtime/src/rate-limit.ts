import type { Attempt, RuntimeState } from "@iz/schema";

/** §8: max 10 attempts per team per gate in any rolling 10 minutes. */
export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const RATE_MAX_ATTEMPTS = 10;
/** Wait time starts at 60s and doubles per extra attempt beyond 10, capped at 900s. */
export const RATE_BASE_SECONDS = 60;
export const RATE_MAX_SECONDS = 900;
/** state.attempts entries are capped to the last 50 per key to bound memory. */
export const MAX_TRACKED_ATTEMPTS = 50;

export interface RateVerdict {
  limited: boolean;
  retryAfterSeconds?: number;
  recent: number;
}

/**
 * Rate-limit verdict for one key (gate id, or report id for report gates).
 *
 * Attempts are recorded ONLY as AnswerRejected / ReportRejected events, so
 * fold rebuilds them and the limit survives restarts. Rate-limited attempts
 * are recorded too ("abusers dig deeper"); correct answers are not attempts.
 *
 * The rolling window uses real session time (the injected clock), not world
 * time: this is an anti-brute-force guard, not fiction. retryAfterSeconds for
 * the first blocked attempt is the 60s base (recent == 10), then doubles per
 * extra attempt already on record, capped at 900s.
 */
export function rateLimitFor(state: RuntimeState, key: string, now: string): RateVerdict {
  const nowMs = Date.parse(now);
  const attempts = state.attempts[key] ?? [];
  let recent = 0;
  if (!Number.isNaN(nowMs)) {
    for (const attempt of attempts) {
      const atMs = Date.parse(attempt.at);
      if (!Number.isNaN(atMs) && atMs > nowMs - RATE_WINDOW_MS) recent += 1;
    }
  }
  if (recent < RATE_MAX_ATTEMPTS) return { limited: false, recent };
  const extra = recent - RATE_MAX_ATTEMPTS;
  return { limited: true, retryAfterSeconds: Math.min(RATE_BASE_SECONDS * 2 ** extra, RATE_MAX_SECONDS), recent };
}

/** fold-side attempt recording with the 50-entry cap (keeps the NEWEST 50). */
export function recordAttempt(attempts: Record<string, Attempt[]>, key: string, at: string, by: string): void {
  const arr = attempts[key] ?? [];
  arr.push({ at, by });
  attempts[key] = arr.length > MAX_TRACKED_ATTEMPTS ? arr.slice(arr.length - MAX_TRACKED_ATTEMPTS) : arr;
}
