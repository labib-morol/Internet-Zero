import { describe, expect, it } from "vitest";
import {
  bearer,
  createGuestSession,
  createTestApp,
  FIXTURE_WORLD_ID,
  postgresUp,
} from "./helpers.js";

const pgUp = await postgresUp();

describe.skipIf(!pgUp)("sessions", () => {
  it("creates a guest session: recovery code shown once, signed httpOnly cookie", async () => {
    const env = await createTestApp();
    try {
      const res = await env.app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { worldId: FIXTURE_WORLD_ID },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.displayName).toMatch(/^Guest \d{4}$/);
      expect(body.sessionToken).toMatch(/^[0-9a-f]{64}$/);
      expect(body.recoveryCode).toMatch(/^[0-9a-f]{16}$/);
      expect(body.teamId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.userId).toMatch(/^[0-9a-f-]{36}$/);

      const cookie = res.cookies[0];
      expect(cookie).toBeDefined();
      expect(cookie!.name).toBe("iz_session");
      expect(cookie!.httpOnly).toBe(true);
      expect(cookie!.sameSite).toBe("Lax");
      // Signed cookie: value carries the HMAC suffix.
      expect(cookie!.value).toContain(".");
    } finally {
      await env.close();
    }
  });

  it("authenticates /api/state via the session cookie and via Bearer token", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);

      const viaCookie = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: { cookie: session.cookie },
      });
      expect(viaCookie.statusCode).toBe(200);
      const state = viaCookie.json().state;
      expect(state.teamId).toBe(session.teamId);
      expect(state.worldId).toBe(FIXTURE_WORLD_ID);
      expect(state.score).toBe(0);
      expect(Array.isArray(state.unlocked)).toBe(true);

      const viaBearer = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(session.sessionToken),
      });
      expect(viaBearer.statusCode).toBe(200);
      expect(viaBearer.json().state.teamId).toBe(session.teamId);
    } finally {
      await env.close();
    }
  });

  it("rejects unauthenticated access to guarded routes", async () => {
    const env = await createTestApp();
    try {
      for (const [method, url] of [
        ["GET", "/api/state"],
        ["POST", "/api/actions"],
        ["GET", "/api/worlds"],
      ] as const) {
        const res = await env.app.inject({ method, url });
        expect(res.statusCode).toBe(401);
      }
      const badToken = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer("deadbeef".repeat(8)),
      });
      expect(badToken.statusCode).toBe(401);
    } finally {
      await env.close();
    }
  });

  it("resumes from the recovery code and rejects unknown codes", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);

      const resume = await env.app.inject({
        method: "POST",
        url: "/api/sessions/resume",
        payload: { recoveryCode: session.recoveryCode },
      });
      expect(resume.statusCode).toBe(201);
      const resumed = resume.json();
      expect(resumed.userId).toBe(session.userId);
      expect(resumed.teamId).toBe(session.teamId);
      expect(resumed.sessionToken).not.toBe(session.sessionToken);

      // The fresh token is a working session.
      const state = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(resumed.sessionToken),
      });
      expect(state.statusCode).toBe(200);

      const bad = await env.app.inject({
        method: "POST",
        url: "/api/sessions/resume",
        payload: { recoveryCode: "0123456789abcdef" },
      });
      expect(bad.statusCode).toBe(401);

      const tooShort = await env.app.inject({
        method: "POST",
        url: "/api/sessions/resume",
        payload: { recoveryCode: "short" },
      });
      expect(tooShort.statusCode).toBe(400);
    } finally {
      await env.close();
    }
  });

  it("rejects unknown worlds with 404", async () => {
    const env = await createTestApp();
    try {
      const res = await env.app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { worldId: "no-such-world" },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await env.close();
    }
  });

  it("rejects malformed session bodies with 400", async () => {
    const env = await createTestApp();
    try {
      const res = await env.app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { worldId: FIXTURE_WORLD_ID, extra: "field" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await env.close();
    }
  });
});
