import { describe, expect, it } from "vitest";
import {
  bearer,
  createGuestSession,
  createTestApp,
  listen,
  postgresUp,
  WsClient,
} from "./helpers.js";

/**
 * Task 2: identity, recovery and live team state.
 *  - WS hello must bind the SESSION's team (REST and one socket must agree).
 *  - Recovery must restore the session's last team, not the first membership.
 *  - Logout must revoke the session everywhere: Bearer, cookie, new and OPEN
 *    sockets; and clear the cookie.
 *  - The 6-member cap must hold under concurrent joins.
 */

const pgUp = await postgresUp();

describe.skipIf(!pgUp)("session identity, recovery and live team state", () => {
  it("websocket hello binds the session's team, not the first membership", async () => {
    const env = await createTestApp();
    try {
      const { wsUrl } = await listen(env.app);
      const owner = await createGuestSession(env.app, "tutorial");
      const joiner = await createGuestSession(env.app, "tutorial");

      const invite = await env.app.inject({
        method: "POST",
        url: "/api/teams/invite",
        headers: bearer(owner.sessionToken),
      });
      const code = invite.json().code as string;
      const joined = await env.app.inject({
        method: "POST",
        url: "/api/teams/join",
        headers: bearer(joiner.sessionToken),
        payload: { code },
      });
      expect(joined.statusCode).toBe(200);

      // The owner acts on the SHARED team after the join: a claim appends a
      // ClaimCreated event that can only exist on the owner's team stream.
      const acted = await env.app.inject({
        method: "POST",
        url: "/api/actions",
        headers: bearer(owner.sessionToken),
        payload: { action: { type: "claim", text: "owner note on shared case" } },
      });
      expect(acted.statusCode).toBe(200);
      expect(acted.json().rejection).toBeUndefined();

      // The joiner's socket must stream the JOINED team: the owner's claim
      // event is only on that team's stream. Binding the joiner's FIRST
      // membership (their original solo team) would replay none of it.
      const ws = await WsClient.open(wsUrl, { sessionToken: joiner.sessionToken, lastSeq: 0 });
      try {
        await ws.waitFor("welcome");
        let sawClaim = false;
        for (let i = 0; i < 5 && !sawClaim; i++) {
          const batch = await ws.waitFor("events", 5_000);
          sawClaim = batch.events.some((envelope) => envelope.event.type === "ClaimCreated");
        }
        expect(sawClaim).toBe(true);

        // Live sync: a second owner action reaches the joiner's open socket.
        const second = await env.app.inject({
          method: "POST",
          url: "/api/actions",
          headers: bearer(owner.sessionToken),
          payload: { action: { type: "claim", text: "live sync check" } },
        });
        expect(second.statusCode).toBe(200);
        let sawLiveClaim = false;
        for (let i = 0; i < 5 && !sawLiveClaim; i++) {
          const batch = await ws.waitFor("events", 5_000);
          sawLiveClaim = batch.events.some(
            (envelope) =>
              envelope.event.type === "ClaimCreated" &&
              (envelope.event as { text?: string }).text === "live sync check"
          );
        }
        expect(sawLiveClaim).toBe(true);
      } finally {
        await ws.close();
      }
    } finally {
      await env.close();
    }
  });

  it("logout revokes the session for bearer, cookie and new websockets", async () => {
    const env = await createTestApp();
    try {
      const { wsUrl } = await listen(env.app);
      const session = await createGuestSession(env.app, "tutorial");

      const before = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(session.sessionToken),
      });
      expect(before.statusCode).toBe(200);

      const logout = await env.app.inject({
        method: "POST",
        url: "/api/sessions/logout",
        headers: bearer(session.sessionToken),
      });
      expect(logout.statusCode).toBe(204);

      const afterBearer = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(session.sessionToken),
      });
      expect(afterBearer.statusCode).toBe(401);

      const afterCookie = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: { cookie: session.cookie },
      });
      expect(afterCookie.statusCode).toBe(401);

      const ws = await WsClient.open(wsUrl);
      ws.send({ t: "hello", sessionToken: session.sessionToken, lastSeq: 0 });
      const close = await ws.closePromise;
      expect(close.code).toBe(1008);
    } finally {
      await env.close();
    }
  });

  it("logout closes already-open websockets and clears the cookie", async () => {
    const env = await createTestApp();
    try {
      const { wsUrl } = await listen(env.app);
      const session = await createGuestSession(env.app, "tutorial");

      const ws = await WsClient.open(wsUrl, { sessionToken: session.sessionToken, lastSeq: 0 });
      let logout;
      try {
        await ws.waitFor("welcome");

        logout = await env.app.inject({
          method: "POST",
          url: "/api/sessions/logout",
          headers: bearer(session.sessionToken),
        });
        expect(logout.statusCode).toBe(204);

        const close = await ws.closePromise;
        expect(close.code).toBe(1008);
      } finally {
        await ws.close().catch(() => {});
      }

      const setCookie = logout.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      expect(String(setCookie)).toMatch(/iz_session=;/);
    } finally {
      await env.close();
    }
  });

  it("resume restores the joined team, not the first membership", async () => {
    const env = await createTestApp();
    try {
      const owner = await createGuestSession(env.app, "tutorial");
      const joiner = await createGuestSession(env.app, "tutorial");

      const invite = await env.app.inject({
        method: "POST",
        url: "/api/teams/invite",
        headers: bearer(owner.sessionToken),
      });
      const code = invite.json().code as string;
      const joined = await env.app.inject({
        method: "POST",
        url: "/api/teams/join",
        headers: bearer(joiner.sessionToken),
        payload: { code },
      });
      expect(joined.statusCode).toBe(200);

      const resumed = await env.app.inject({
        method: "POST",
        url: "/api/sessions/resume",
        payload: { recoveryCode: joiner.recoveryCode },
      });
      expect(resumed.statusCode).toBe(201);
      expect(resumed.json().teamId).toBe(owner.teamId);
    } finally {
      await env.close();
    }
  });

  it("re-joining a team the user already belongs to rebinds instead of erroring", async () => {
    const env = await createTestApp();
    try {
      const owner = await createGuestSession(env.app, "tutorial");
      const joiner = await createGuestSession(env.app, "tutorial");
      const invite = await env.app.inject({
        method: "POST",
        url: "/api/teams/invite",
        headers: bearer(owner.sessionToken),
      });
      const code = invite.json().code as string;

      // While still bound to their OWN team, the joiner can mint their own
      // invite. Joining the owner's team rebinds them; re-joining their own
      // team with that code is then a rebind, not a 500 — and re-joining the
      // owner's team again must work too.
      const own = await env.app.inject({
        method: "POST",
        url: "/api/teams/invite",
        headers: bearer(joiner.sessionToken),
      });
      const ownCode = own.json().code as string;
      expect(own.statusCode).toBe(201);

      const joined = await env.app.inject({
        method: "POST",
        url: "/api/teams/join",
        headers: bearer(joiner.sessionToken),
        payload: { code },
      });
      expect(joined.statusCode).toBe(200);

      const joinOwn = await env.app.inject({
        method: "POST",
        url: "/api/teams/join",
        headers: bearer(joiner.sessionToken),
        payload: { code: ownCode },
      });
      expect(joinOwn.statusCode).toBe(200);
      expect(joinOwn.json()).toMatchObject({ alreadyMember: true });

      const rejoin = await env.app.inject({
        method: "POST",
        url: "/api/teams/join",
        headers: bearer(joiner.sessionToken),
        payload: { code },
      });
      expect(rejoin.statusCode).toBe(200);
      expect(rejoin.json()).toMatchObject({ alreadyMember: true, teamId: owner.teamId });
    } finally {
      await env.close();
    }
  });

  it("the six-member cap holds under concurrent joins", async () => {
    const env = await createTestApp();
    try {
      const owner = await createGuestSession(env.app, "tutorial");
      const invite = await env.app.inject({
        method: "POST",
        url: "/api/teams/invite",
        headers: bearer(owner.sessionToken),
      });
      const code = invite.json().code as string;

      // Four sequential joiners → 5 members.
      for (let i = 0; i < 4; i++) {
        const guest = await createGuestSession(env.app, "tutorial");
        const res = await env.app.inject({
          method: "POST",
          url: "/api/teams/join",
          headers: bearer(guest.sessionToken),
          payload: { code },
        });
        expect(res.statusCode).toBe(200);
      }

      // Three simultaneous joiners race for the last seat: exactly one wins.
      const racers = await Promise.all(
        [0, 1, 2].map(async () => {
          const guest = await createGuestSession(env.app, "tutorial");
          const res = await env.app.inject({
            method: "POST",
            url: "/api/teams/join",
            headers: bearer(guest.sessionToken),
            payload: { code },
          });
          return res.statusCode;
        })
      );
      expect(racers.filter((status) => status === 200)).toHaveLength(1);
      expect(racers.filter((status) => status === 409)).toHaveLength(2);

      const members = await env.app.inject({
        method: "GET",
        url: "/api/teams/members",
        headers: bearer(owner.sessionToken),
      });
      expect(members.json().members).toHaveLength(6);
    } finally {
      await env.close();
    }
  });
});
