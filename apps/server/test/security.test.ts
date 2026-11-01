import { describe, expect, it } from "vitest";
import { CSP } from "../src/security.js";
import {
  bearer,
  createGuestSession,
  createTestApp,
  FIXTURE_WORLD_ID,
  postgresUp,
} from "./helpers.js";

const pgUp = await postgresUp();

describe.skipIf(!pgUp)("security: rate limit, body limit, headers", () => {
  it("applies a 120 req/min per-IP token bucket with Retry-After", async () => {
    const env = await createTestApp();
    try {
      const codes: number[] = [];
      let retryAfter: unknown;
      for (let i = 0; i < 130; i++) {
        const res = await env.app.inject({ method: "GET", url: "/api/worlds" });
        codes.push(res.statusCode);
        if (res.statusCode === 429 && retryAfter === undefined) {
          retryAfter = res.headers["retry-after"];
        }
      }
      // The bucket admits ~120 requests (plus refill) before responding 429.
      const limitedCount = codes.filter((code) => code === 429).length;
      expect(limitedCount).toBeGreaterThan(0);
      expect(limitedCount).toBeLessThan(30);
      // Unauthenticated guarded requests are 401 before the bucket empties.
      expect(codes.filter((code) => code === 401).length).toBeGreaterThan(100);
      expect(retryAfter).toBeDefined();
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
    } finally {
      await env.close();
    }
  });

  it("leaves health endpoints outside the rate limit", async () => {
    const env = await createTestApp();
    try {
      for (let i = 0; i < 150; i++) {
        const res = await env.app.inject({ method: "GET", url: "/healthz" });
        expect(res.statusCode).toBe(200);
      }
    } finally {
      await env.close();
    }
  });

  it("rejects REST bodies over 256 KB with 413", async () => {
    const env = await createTestApp();
    try {
      const pad = "x".repeat(300 * 1024);
      const res = await env.app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ worldId: FIXTURE_WORLD_ID, pad }),
      });
      expect(res.statusCode).toBe(413);
    } finally {
      await env.close();
    }
  });

  it("sets the strict security headers on every response (no HSTS for http origins)", async () => {
    const env = await createTestApp();
    try {
      const res = await env.app.inject({ method: "GET", url: "/healthz" });
      expect(res.headers["content-security-policy"]).toBe(CSP);
      expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["strict-transport-security"]).toBeUndefined();
    } finally {
      await env.close();
    }
  });

  it("sets HSTS when PUBLIC_ORIGIN is https", async () => {
    const env = await createTestApp({ publicOrigin: "https://intranet-zero.example.org" });
    try {
      const res = await env.app.inject({ method: "GET", url: "/healthz" });
      expect(res.headers["strict-transport-security"]).toContain("max-age=31536000");
    } finally {
      await env.close();
    }
  });

  it("never leaks canon or answer hashes through /api/worlds or /api/state", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);
      const worlds = await env.app.inject({
        method: "GET",
        url: "/api/worlds",
        headers: bearer(session.sessionToken),
      });
      expect(worlds.statusCode).toBe(200);
      const world = worlds.json().worlds[0];
      expect(world.worldId).toBe(FIXTURE_WORLD_ID);
      expect(world.title).toBe("Fixture World");
      expect(Object.keys(world).sort()).toEqual([
        "bundleHash",
        "entry",
        "hosts",
        "summary",
        "title",
        "version",
        "worldId",
      ]);

      const state = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(session.sessionToken),
      });
      const raw = state.body;
      for (const forbidden of ["facts", "beliefs", "proofs", "statements", "answerHash", "canon", "bundleSalt"]) {
        expect(raw.includes(`"${forbidden}"`)).toBe(false);
      }
    } finally {
      await env.close();
    }
  });
});
