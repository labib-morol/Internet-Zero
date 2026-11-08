import { afterEach, describe, expect, it } from "vitest";
import { TeamSocket } from "../src/api/ws.js";
import type { EventEnvelope } from "@iz/schema";

/**
 * TeamSocket cursor semantics (Task 2): the replay cursor is PER TEAM. A team
 * switch must reset it, or the new team's events below the old team's lastSeq
 * are silently skipped by the server replay.
 */

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | undefined;
  onmessage: ((event: { data: string }) => void) | undefined;
  onclose: ((event: { code: number; reason: string }) => void) | undefined;
  onerror: (() => void) | undefined;
  sent: string[] = [];
  lastHello(): { sessionToken: string; lastSeq: number } {
    const hello = this.sent.find((raw) => JSON.parse(raw).t === "hello");
    if (hello === undefined) throw new Error("no hello sent");
    return JSON.parse(hello) as { sessionToken: string; lastSeq: number };
  }
  send(raw: string): void {
    this.sent.push(raw);
  }
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
  openAsConnected(): void {
    this.onopen?.();
  }
}

function makeSocketFactory() {
  const sockets: FakeWebSocket[] = [];
  return {
    sockets,
    impl: class extends FakeWebSocket {
      constructor() {
        super();
        sockets.push(this);
      }
    },
  };
}

function envelope(seq: number): { seq: number; event: unknown } {
  const event = { type: "ClaimCreated", claimId: `cl.${seq}`, text: "x", createdBy: "u", createdAt: "t", private: false };
  return { seq, event } as unknown as EventEnvelope extends never ? never : { seq: number; event: unknown };
}

describe("TeamSocket replay cursor", () => {
  const originalWebSocket = globalThis.WebSocket;
  afterEach(() => {
    Object.defineProperty(globalThis, "WebSocket", { value: originalWebSocket, writable: true });
  });

  it("keeps the cursor across a same-team reconnect", () => {
    const factory = makeSocketFactory();
    Object.defineProperty(globalThis, "WebSocket", { value: factory.impl, writable: true });
    const socket = new TeamSocket({ onEnvelopes: () => {}, onStatus: () => {} });
    socket.start("tok");
    let ws = factory.sockets[0]!;
    ws.openAsConnected();
    ws.onmessage?.({ data: JSON.stringify({ t: "welcome", seq: 5 }) });
    ws.onmessage?.({ data: JSON.stringify({ t: "events", events: [envelope(5)], seq: 5 }) });
    expect(socket.lastSeq).toBe(5);

    socket.restart("tok");
    ws = factory.sockets[1]!;
    ws.openAsConnected();
    expect(ws.lastHello().lastSeq).toBe(5);
  });

  it("resetStream clears the cursor so the next hello replays from zero", () => {
    const factory = makeSocketFactory();
    Object.defineProperty(globalThis, "WebSocket", { value: factory.impl, writable: true });
    const socket = new TeamSocket({ onEnvelopes: () => {}, onStatus: () => {} });
    socket.start("tok");
    let ws = factory.sockets[0]!;
    ws.openAsConnected();
    ws.onmessage?.({ data: JSON.stringify({ t: "welcome", seq: 12 }) });
    expect(socket.lastSeq).toBe(12);

    socket.stop();
    socket.resetStream();
    expect(socket.lastSeq).toBe(0);

    socket.start("tok");
    ws = factory.sockets[1]!;
    ws.openAsConnected();
    expect(ws.lastHello().lastSeq).toBe(0);
  });
});
