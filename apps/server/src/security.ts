import type { FastifyInstance, FastifyRequest } from "fastify";
import { SESSION_COOKIE } from "./config.js";

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
 * The client IP for rate limiting. Behind a trusted single proxy (TRUST_PROXY=1,
 * e.g. Render), the client IP is the RIGHTMOST X-Forwarded-For entry: the one
 * the trusted peer appended. Client-supplied leftmost entries never split or
 * forge buckets. Direct exposure uses the socket address.
 */
export function clientIp(request: FastifyRequest, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    // Some proxies emit repeated XFF headers (Node surfaces an array) — the
    // rightmost entry across the joined chain is still the trusted peer's.
    const chain = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
    if (typeof chain === "string" && chain.length > 0) {
      const entries = chain.split(",");
      const rightmost = entries[entries.length - 1]?.trim();
      if (rightmost !== undefined && rightmost !== "") return rightmost;
    }
  }
  return request.ip;
}

/**
 * In-memory token bucket, 120 requests/minute per IP: bucket of 120 tokens,
 * refilled continuously at 2 tokens/s. Health endpoints are exempt so
 * orchestrators cannot lock themselves out.
 */
export function registerRateLimit(app: FastifyInstance, opts: RateLimitOptions & { trustProxy: boolean }): void {
  const capacity = opts.requestsPerMinute;
  const refillPerMs = capacity / 60_000;
  const buckets = new Map<string, Bucket>();

  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0] ?? request.url;
    if (url === "/healthz" || url === "/readyz") return;
    if (request.method === "OPTIONS") return;

    const ip = clientIp(request, opts.trustProxy);
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
      // Return the reply: in an async hook, merely sending it does not stop
      // the lifecycle — the route handler must not run for a 429.
      return reply.code(429).send({ error: "rate_limited" });
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

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function hostAllowed(originHost: string, host: string | undefined, publicOrigin: string): boolean {
  if (host !== undefined && originHost === host.toLowerCase()) return true;
  try {
    if (originHost === new URL(publicOrigin).host.toLowerCase()) return true;
  } catch {
    /* malformed publicOrigin — fall through to the dev check */
  }
  // Dev convenience: any localhost-port client against a localhost server
  // (vite dev). Closed in production, where publicOrigin is not local.
  const publicHostname = new URL(publicOrigin).host.toLowerCase().split(":")[0] ?? "";
  const originHostname = originHost.split(":")[0] ?? "";
  return LOCAL_HOSTNAMES.has(publicHostname) && LOCAL_HOSTNAMES.has(originHostname);
}

/**
 * CSRF/origin gate for cookie-authenticated mutations (§16): browsers attach
 * the session cookie ambiently, so a state-changing request that authenticates
 * via cookie must present an Origin that matches the server's own host (or
 * the configured public origin). Bearer-authenticated (non-browser) requests
 * carry no ambient credentials and are exempt, as are cookie-less requests
 * (guest creation). GET/HEAD/OPTIONS are never gated.
 */
export function registerMutationOriginGuard(
  app: FastifyInstance,
  opts: { publicOrigin: string }
): void {
  app.addHook("onRequest", async (request, reply) => {
    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    // Exempt only a REAL bearer credential (auth.ts falls back to cookie auth
    // on an empty Bearer token — that request is still cookie-ambient).
    const authorization = request.headers.authorization;
    if (typeof authorization === "string" && authorization.startsWith("Bearer ") && authorization.slice("Bearer ".length).trim() !== "") {
      return;
    }
    if (request.cookies[SESSION_COOKIE] === undefined) return; // nothing ambient to forge with

    const origin = request.headers.origin;
    if (origin === undefined) {
      // Return the reply to halt the lifecycle (route handler must not run).
      return reply.code(403).send({ error: "origin_required" });
    }
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return reply.code(403).send({ error: "invalid_origin" });
    }
    if (!hostAllowed(originHost, request.headers.host, opts.publicOrigin)) {
      return reply.code(403).send({ error: "cross_origin_forbidden" });
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
    // Session, state and note responses are per-team private data: never
    // cacheable by shared caches or the browser. Asset routes set their own
    // private caching and are NOT under /api/.
    const path = reply.request.url.split("?")[0] ?? reply.request.url;
    if (path === "/api" || path.startsWith("/api/")) {
      reply.header("Cache-Control", "private, no-store");
    }
  });
}
