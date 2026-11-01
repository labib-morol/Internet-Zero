import { describe, expect, it } from "vitest";
import { MAX_ACTIONS_PER_SECOND, MAX_WS_PAYLOAD } from "../src/ws.js";
import {
  bearer,
  createGuestSession,
  createTestApp,
  listen,
  postgresUp,
  WsClient,
} from "./helpers.js";

const pgUp = await postgresUp();

describe.skipIf(!pgUp)("websocket protocol", () => {
  it("closes hellos with invalid tokens and malformed messages", async () => {
    const env = await createTestApp();
    try {
      const { wsUrl } = await listen(env.app);

      const badToken = await WsClient.open(wsUrl);
      badToken.send({ t: "hello", sessionToken: "f".repeat(64), lastSeq: 0 });
      const badClose = await badToken.closePromise;
      expect(badClose.code).toBe(1008);

      const notJson = await WsClient.open(wsUrl);
      notJson.send("this is not json");
      const jsonClose = await notJson.closePromise;
      expect(jsonClose.code).toBe(1002);

      const badShape = await WsClient.open(wsUrl);
      badShape.send({ t: "nope" });
      const shapeClose = await badShape.closePromise;
      expect(shapeClose.code).toBe(1008);

      const actionBeforeHello = await WsClient.open(wsUrl);
      actionBeforeHello.send({ t: "action", clientId: "c1", action: { type: "claim", text: "hi" } });
      const helloClose = await actionBeforeHello.closePromise;
      expect(helloClose.code).toBe(1008);
    } finally {
      await env.close();
    }
  });

  it("welcomes, replays after lastSeq, answers pings and results actions", async () => {
    const env = await createTestApp();
    try {
      const { wsUrl } = await listen(env.app);
      const session = await createGuestSession(env.app);

      // One action exists on the stream before connecting (via REST).
      await env.app.inject({
        method: "POST",
        url: "/api/actions",
        headers: bearer(session.sessionToken),
        payload: { action: { type: "claim", text: "before connect" } },
      });

      const client = await WsClient.open(wsUrl, { sessionToken: session.sessionToken, lastSeq: 0 });
      const welcome = await client.waitFor("welcome");
      expect(welcome.seq).toBe(2); // SessionStarted + claim

      const replay = await client.waitFor("events");
      expect(replay.seq).toBe(2);
      expect(replay.events.map((envelope) => envelope.event.type)).toEqual([
        "SessionStarted",
        "ClaimCreated",
      ]);

      client.send({ t: "ping" });
      const pong = await client.waitFor("pong");
      expect(pong.t).toBe("pong");

      client.send({ t: "action", clientId: "c-42", action: { type: "claim", text: "via websocket" } });
      const result = await client.waitFor("result");
      expect(result.clientId).toBe("c-42");
      expect(result.rejection).toBeUndefined();
      expect((result.result as { claimId: string }).claimId).toMatch(/^cl\./);

      // The action's events are broadcast to the same connection as well.
      const broadcast = await client.waitFor("events");
      expect(broadcast.seq).toBe(3);
      expect(broadcast.events.map((envelope) => envelope.event.type)).toContain("ClaimCreated");

      // The WebSocket action really landed in the shared store.
      const state = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(session.sessionToken),
      });
      const texts = Object.values(
        (state.json().state as { claims: Record<string, { text: string }> }).claims
      ).map((c) => c.text);
      expect(texts).toContain("via websocket");

      await client.close();
    } finally {
      await env.close();
    }
  });

  it("closes connections that exceed 20 actions per second", async () => {
    const env = await createTestApp();
    try {
      const { wsUrl } = await listen(env.app);
      const session = await createGuestSession(env.app);
      const client = await WsClient.open(wsUrl, { sessionToken: session.sessionToken, lastSeq: 0 });
      await client.waitFor("welcome");
      await client.waitFor("events");

      for (let i = 0; i <= MAX_ACTIONS_PER_SECOND; i++) {
        client.send({
          t: "action",
          clientId: `c-${i}`,
          action: { type: "claim", text: `spam ${i}` },
        });
      }
      const close = await client.closePromise;
      expect(close.code).toBe(1008);
      expect(close.reason).toContain("action rate");
    } finally {
      await env.close();
    }
  });

  it("closes connections that send messages larger than 64 KB", async () => {
    const env = await createTestApp();
    try {
      const { wsUrl } = await listen(env.app);
      const session = await createGuestSession(env.app);
      const client = await WsClient.open(wsUrl, { sessionToken: session.sessionToken, lastSeq: 0 });
      await client.waitFor("welcome");
      await client.waitFor("events");

      const oversized = "x".repeat(MAX_WS_PAYLOAD + 1024);
      client.send(oversized);
      const close = await client.closePromise;
      // The ws server enforces maxPayload and kills the link (1009 close
      // frame, or an abnormal 1006 when it terminates mid-frame).
      expect([1006, 1009]).toContain(close.code);
    } finally {
      await env.close();
    }
  });
});
