import { describe, expect, it } from "vitest";
import {
  bearer,
  createGuestSession,
  createTestApp,
  listen,
  postgresUp,
  WsClient,
} from "./helpers.js";

const pgUp = await postgresUp();

describe.skipIf(!pgUp)("team isolation", () => {
  it("keeps /api/state and /api/actions scoped to the calling user's team", async () => {
    const env = await createTestApp();
    try {
      const alice = await createGuestSession(env.app);
      const bob = await createGuestSession(env.app);
      expect(alice.teamId).not.toBe(bob.teamId);

      const submit = await env.app.inject({
        method: "POST",
        url: "/api/actions",
        headers: bearer(alice.sessionToken),
        payload: { action: { type: "claim", text: "alice private observation" } },
      });
      expect(submit.statusCode).toBe(200);

      const aliceState = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(alice.sessionToken),
      });
      const bobState = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(bob.sessionToken),
      });
      const aliceJson = aliceState.json().state as Record<string, unknown> & {
        claims: Record<string, { text: string }>;
      };
      const bobJson = bobState.json().state as Record<string, unknown> & {
        claims: Record<string, { text: string }>;
      };

      expect(Object.values(aliceJson.claims).map((c) => c.text)).toContain(
        "alice private observation"
      );
      expect(bobJson.claims).toEqual({});
      expect(bobJson.teamId).toBe(bob.teamId);
      expect(bobJson.teamId).not.toBe(aliceJson.teamId);

      // Bob's writes never touch Alice's stream either.
      await env.app.inject({
        method: "POST",
        url: "/api/actions",
        headers: bearer(bob.sessionToken),
        payload: { action: { type: "claim", text: "bob private observation" } },
      });
      const aliceAgain = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(alice.sessionToken),
      });
      const aliceTexts = Object.values(
        (aliceAgain.json().state as { claims: Record<string, { text: string }> }).claims
      ).map((c) => c.text);
      expect(aliceTexts).toContain("alice private observation");
      expect(aliceTexts).not.toContain("bob private observation");
    } finally {
      await env.close();
    }
  });

  it("websocket rooms only ever deliver same-team events", async () => {
    const env = await createTestApp();
    try {
      const { wsUrl } = await listen(env.app);
      const alice = await createGuestSession(env.app);
      const bob = await createGuestSession(env.app);

      const wsAlice = await WsClient.open(wsUrl, { sessionToken: alice.sessionToken, lastSeq: 0 });
      const wsBob = await WsClient.open(wsUrl, { sessionToken: bob.sessionToken, lastSeq: 0 });

      // Both teams start with SessionStarted (seq 1).
      const aliceWelcome = await wsAlice.waitFor("welcome");
      expect(aliceWelcome.seq).toBe(1);
      const bobWelcome = await wsBob.waitFor("welcome");
      expect(bobWelcome.seq).toBe(1);
      await wsAlice.waitFor("events");
      await wsBob.waitFor("events");

      // Alice acts over REST: only Alice's socket may hear about it.
      await env.app.inject({
        method: "POST",
        url: "/api/actions",
        headers: bearer(alice.sessionToken),
        payload: { action: { type: "claim", text: "alice-only event" } },
      });
      const aliceEvents = await wsAlice.waitFor("events");
      expect(aliceEvents.events.map((envelope) => envelope.event.type)).toContain("ClaimCreated");
      expect(aliceEvents.seq).toBe(2);
      await wsBob.expectSilence(500);

      // Bob acts: Alice's socket must stay silent.
      await env.app.inject({
        method: "POST",
        url: "/api/actions",
        headers: bearer(bob.sessionToken),
        payload: { action: { type: "claim", text: "bob-only event" } },
      });
      const bobEvents = await wsBob.waitFor("events");
      expect(bobEvents.seq).toBe(2);
      await wsAlice.expectSilence(500);

      // Alice cannot replay Bob's stream by asking for seq 0 again on a new
      // socket with Bob's token semantics — replay is scoped to her own team.
      const wsAlice2 = await WsClient.open(wsUrl, { sessionToken: alice.sessionToken, lastSeq: 0 });
      const replay = await wsAlice2.waitFor("events");
      const replayTexts = replay.events
        .map((envelope) => envelope.event)
        .filter((event) => event.type === "ClaimCreated")
        .map((event) => (event as { text?: string }).text);
      expect(replayTexts).toContain("alice-only event");
      expect(replayTexts).not.toContain("bob-only event");

      await Promise.all([wsAlice.close(), wsBob.close(), wsAlice2.close()]);
    } finally {
      await env.close();
    }
  });
});
