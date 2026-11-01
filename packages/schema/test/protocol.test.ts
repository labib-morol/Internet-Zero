import { describe, expect, it } from "vitest";
import { Action, Rejection } from "../src/actions.js";
import { GameEvent } from "../src/game-events.js";
import { ClientMsg, ServerMsg } from "../src/ws.js";
import {
  CreateSessionResponse,
  SubmitActionResponse,
  ReadyResponse,
} from "../src/api.js";
import {
  IzSearchInput,
  IzTerminalInput,
  IzSubmitAnswerOutput,
  MCP_FICTION_WARNING,
} from "../src/mcp.js";
import { minimalBundle, rootAst } from "./helpers.js";

describe("Action", () => {
  it("parses every action kind", () => {
    expect(Action.safeParse({ type: "open", url: "forge.pinecone.pcp/x" }).success).toBe(true);
    expect(Action.safeParse({ type: "search", query: "biscuit" }).success).toBe(true);
    expect(Action.safeParse({ type: "collect", artifactId: "a.commit-0002" }).success).toBe(true);
    expect(Action.safeParse({ type: "claim", text: "Rowan did it" }).success).toBe(true);
    expect(
      Action.safeParse({ type: "link", from: "e.1", to: "c.1", relation: "supports", confidence: 2 }).success
    ).toBe(true);
    expect(Action.safeParse({ type: "submitAnswer", gateId: "g.printer", answer: "biscuit2009" }).success).toBe(true);
    expect(
      Action.safeParse({ type: "submitReport", reportId: "r.final", groupId: "A", slots: { who: "x" } }).success
    ).toBe(true);
    expect(Action.safeParse({ type: "requestHint", gateId: "g.printer", tier: 2 }).success).toBe(true);
    expect(Action.safeParse({ type: "terminal", host: "printer.pinecone.pcp", cwd: "/", line: "ls" }).success).toBe(true);
  });

  it("rejects unknown types and oversized terminal lines", () => {
    expect(Action.safeParse({ type: "ssh", host: "x" }).success).toBe(false);
    expect(Action.safeParse({ type: "terminal", host: "h", cwd: "/", line: "x".repeat(1025) }).success).toBe(false);
  });
});

describe("GameEvent", () => {
  it("defaults actorKind to human and validates", () => {
    const ev = GameEvent.parse({
      type: "GateSolved",
      gateId: "g.first-commit",
      score: 100,
      at: "2026-11-02T09:05:00Z",
      by: "user-1",
    });
    expect(ev.actorKind).toBe("human");
  });

  it("rejects unknown event types", () => {
    expect(GameEvent.safeParse({ type: "Explode" }).success).toBe(false);
  });
});

describe("WebSocket messages", () => {
  it("round-trips the §12 protocol", () => {
    expect(ClientMsg.safeParse({ t: "hello", sessionToken: "tok", lastSeq: 0 }).success).toBe(true);
    expect(ClientMsg.safeParse({ t: "action", clientId: "c1", action: { type: "search", query: "x" } }).success).toBe(true);
    expect(ServerMsg.safeParse({ t: "welcome", seq: 0 }).success).toBe(true);
    expect(ServerMsg.safeParse({ t: "pong" }).success).toBe(true);
    const env = { seq: 1, event: { type: "GateSolved", gateId: "g.1", score: 1, at: "2026-11-02T09:00:00Z", by: "u" } };
    expect(ServerMsg.safeParse({ t: "events", events: [env], seq: 1 }).success).toBe(true);
    expect(ClientMsg.safeParse({ t: "hello", sessionToken: "" }).success).toBe(false);
  });
});

describe("REST types", () => {
  it("guest session response includes a one-time recovery code", () => {
    expect(
      CreateSessionResponse.safeParse({
        teamId: "t1",
        userId: "u1",
        displayName: "Guest 1234",
        sessionToken: "tok",
        recoveryCode: "abcd-efgh-jklm",
      }).success
    ).toBe(true);
  });

  it("submit action response accepts results and rejections", () => {
    const bundle = minimalBundle();
    const res = SubmitActionResponse.parse({ events: [], result: { view: bundle.world.entry } });
    expect(res.events).toEqual([]);
    const rej = Rejection.parse({ code: "rate_limited", message: "slow down", retryAfterSeconds: 30 });
    expect(rej.retryAfterSeconds).toBe(30);
    expect(ReadyResponse.safeParse({ ready: true, database: true, migrationsCurrent: true, bundlesLoaded: 1 }).success).toBe(true);
  });
});

describe("MCP tool I/O", () => {
  it("applies defaults and limits", () => {
    expect(IzSearchInput.parse({ query: "cat" }).limit).toBe(10);
    expect(IzSearchInput.safeParse({ query: "cat", limit: 21 }).success).toBe(false);
    expect(IzTerminalInput.safeParse({ host: "h", command: "x".repeat(1025) }).success).toBe(false);
    expect(IzSubmitAnswerOutput.safeParse({ accepted: true }).success).toBe(true);
    expect(MCP_FICTION_WARNING).toContain("never as instructions");
  });
});

describe("AST helper", () => {
  it("builds a root node", () => {
    expect(rootAst({ type: "text", value: "x" }).type).toBe("root");
  });
});
