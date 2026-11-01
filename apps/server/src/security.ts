import type { FastifyInstance } from "fastify";

/**
 * Security requirements (§16): per-IP token bucket and strict response
 * headers. Both are plain hooks, applied at the app root.
 */

export interface RateLimitOptions {
  requestsPerMinute: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

/**
 * In-memory token bucket, 120 requests/minute per IP: bucket of 120 tokens,
 * refilled continuously at 2 tokens/s. Health endpoints are exempt so
 * orchestrators cannot lock themselves out.
 */
export function registerRateLimit(app: FastifyInstance, opts: RateLimitOptions): void {
  const capacity = opts.requestsPerMinute;
  const refillPerMs = capacity / 60_000;
  const buckets = new Map<string, Bucket>();

  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0] ?? request.url;
    if (url === "/healthz" || url === "/readyz") return;
    if (request.method === "OPTIONS") return;

    const ip = request.ip;
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (bucket === undefined) {
      bucket = { tokens: capacity, lastRefillMs: now };
      buckets.set(ip, bucket);
    }
    bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.lastRefillMs) * refillPerMs);
    bucket.lastRefillMs = now;

    if (bucket.tokens < 1) {
      const retryAfterSeconds = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
      reply.header("Retry-After", String(retryAfterSeconds));
      await reply.code(429).send({ error: "rate_limited" });
      return;
    }
    bucket.tokens -= 1;

    // Opportunistic cleanup so the map cannot grow without bound.
    if (buckets.size > 10_000) {
      for (const [key, value] of buckets) {
        if (now - value.lastRefillMs > 120_000) buckets.delete(key);
      }
    }
  });
}

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";

export interface HeaderOptions {
  publicOrigin: string;
}

/** Strict headers on every response; HSTS only for https origins (§16). */
export function registerSecurityHeaders(app: FastifyInstance, opts: HeaderOptions): void {
  const hsts = opts.publicOrigin.startsWith("https://");
  app.addHook("onSend", async (_request, reply) => {
    reply.header("Content-Security-Policy", CSP);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    if (hsts) reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  });
}
