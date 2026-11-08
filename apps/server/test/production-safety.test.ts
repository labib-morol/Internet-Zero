import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";
import { bearer, createGuestSession, createTestApp, listen, postgresUp, WsClient } from "./helpers.js";
import { Client } from "pg";
import { ADMIN_URL } from "./helpers.js";

/**
 * Task 3: production safety.
 *  - /readyz reports failures with HTTP 503 (orchestrators act on status, not bodies).
 *  - Rate limiting keys on the real client IP behind a trusted proxy.
 *  - Cookie-authenticated mutations require a same-origin (or trusted) Origin.
 *  - Authenticated API responses are not cacheable.
 *  - Production requires a canonical HTTPS public origin.
 *  - A socket that never says hello is closed.
 */

const pgUp = await postgresUp();

describe.skipIf(!pgUp)("production safety", () => {
  it("/readyz returns 503 when the database is unreachable; /healthz stays 200", async () => {
    const env = await createTestApp();
    try {
      const readyBefore = await env.app.inject({ method: "GET", url: "/readyz" });
      expect(readyBefore.statusCode).toBe(200);

      // Pull the database out from under the running app (isolated test DB).
      const admin = new Client({ connectionString: ADMIN_URL });
      await admin.connect();
      await admin.query(`DROP DATABASE "${env.dbName}" WITH (FORCE)`);
      await admin.end();

      const ready = await env.app.inject({ method: "GET", url: "/readyz" });
      expect(ready.statusCode).toBe(503);
      expect(ready.json().ready).toBe(false);

      const live = await env.app.inject({ method: "GET", url: "/healthz" });
      expect(live.statusCode).toBe(200);
    } finally {
      await env.app.close();
    }
  });

  it("rate limiting keys on the client IP behind a trusted proxy and resists forged chains", async () => {
    const env = await createTestApp({ trustProxy: true, requestsPerMinute: 3 });
    try {
      const hit = (xff: string) =>
        env.app.inject({ method: "GET", url: "/api/worlds", headers: { "x-forwarded-for": xff } });

      // Three requests from 1.2.3.4 exhaust that client's bucket.
      expect((await hit("1.2.3.4")).statusCode).toBe(401);
      expect((await hit("1.2.3.4")).statusCode).toBe(401);
      expect((await hit("1.2.3.4")).statusCode).toBe(401);
      expect((await hit("1.2.3.4")).statusCode).toBe(429);

      // A different client is NOT caught in the first bucket.
      expect((await hit("5.6.7.8")).statusCode).toBe(401);

      // A forged multi-hop chain keys on the proxy-added (rightmost) entry:
      // the client-controllable leftmost value must not split buckets.
      expect((await hit("9.9.9.9, 5.6.7.8")).statusCode).toBe(401);
      expect((await hit("5.6.7.8")).statusCode).toBe(401); // third use of the bucket
      expect((await hit("5.6.7.8")).statusCode).toBe(429); // bucket now exhausted

      // A fresh client is untouched by the exhausted bucket above.
      expect((await hit("7.7.7.7")).statusCode).toBe(401);

      // Repeated XFF headers (proxy emitting the header twice) join into one
      // chain instead of collapsing everyone into the proxy's bucket.
      const arrayHit = await env.app.inject({
        method: "GET",
        url: "/api/worlds",
        headers: { "x-forwarded-for": ["8.8.8.8", "6.6.6.6"] },
      });
      expect(arrayHit.statusCode).toBe(401);
    } finally {
      await env.close();
    }
  });

  it("a garbage Bearer header does not bypass the cookie-mutation origin gate", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);
      const bypass = await env.app.inject({
        method: "POST",
        url: "/api/sessions/logout",
        headers: { cookie: session.cookie, authorization: "Bearer ", origin: "https://evil.example" },
      });
      expect(bypass.statusCode).toBe(403);
    } finally {
      await env.close();
    }
  });

  it("cookie-authenticated mutations require a same-origin Origin; bearer requests do not", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);

      // Cookie + hostile origin: rejected.
      const hostile = await env.app.inject({
        method: "POST",
        url: "/api/sessions/logout",
        headers: { cookie: session.cookie, origin: "https://evil.example" },
      });
      expect(hostile.statusCode).toBe(403);

      // Cookie + NO origin (a browser always sends one on POST): rejected.
      const originless = await env.app.inject({
        method: "POST",
        url: "/api/sessions/logout",
        headers: { cookie: session.cookie },
      });
      expect(originless.statusCode).toBe(403);

      // Cookie + same-origin (Host matches): allowed.
      const sameHost = await env.app.inject({
        method: "POST",
        url: "/api/sessions/logout",
        headers: { cookie: session.cookie, origin: "http://localhost:8080" },
      });
      expect(sameHost.statusCode).toBe(204);

      // Bearer (non-browser) needs no Origin.
      const second = await createGuestSession(env.app);
      const viaBearer = await env.app.inject({
        method: "POST",
        url: "/api/sessions/logout",
        headers: { ...bearer(second.sessionToken), origin: "https://evil.example" },
      });
      expect(viaBearer.statusCode).toBe(204);

      // Guest creation posts without a cookie: still open.
      const fresh = await env.app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { worldId: "tutorial" },
      });
      expect(fresh.statusCode).toBe(201);
    } finally {
      await env.close();
    }
  });

  it("authenticated API responses are not cacheable", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);
      const res = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(session.sessionToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toContain("no-store");
    } finally {
      await env.close();
    }
  });

  it("production requires a canonical HTTPS public origin", () => {
    const base = {
      DATABASE_URL: "postgres://intranet:intranet@localhost:5432/iz_test_x",
      SESSION_SECRET: "test-session-secret-0123456789abcdef0123456789abcdef",
      WORLDS_DIR: "dist/worlds",
    };
    expect(() =>
      resolveConfig({ ...base, NODE_ENV: "production", PUBLIC_ORIGIN: "http://intranet.example" })
    ).toThrow(/https/);
    expect(
      resolveConfig({ ...base, NODE_ENV: "production", PUBLIC_ORIGIN: "https://intranet.example" }).publicOrigin
    ).toBe("https://intranet.example");
    // Dev stays permissive.
    expect(resolveConfig({ ...base, PUBLIC_ORIGIN: "http://localhost:8080" }).publicOrigin).toBe(
      "http://localhost:8080"
    );
  });

  it("a websocket that never says hello is closed", async () => {
    const env = await createTestApp({ wsHelloTimeoutMs: 150 });
    try {
      const { wsUrl } = await listen(env.app);
      const ws = await WsClient.open(wsUrl);
      const close = await ws.closePromise;
      expect(close.code).toBe(1008);
    } finally {
      await env.close();
    }
  });
});
