import type { FastifyInstance, FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "@fastify/websocket";
import type { Action, Actor, ServerMsg as ServerMsgType, WorldBundle } from "@iz/schema";
import { ClientMsg, ServerMsg } from "@iz/schema";
import type { Db } from "./db/client.js";
import { nextSeq, readAfter } from "./db/events.js";
import type { EventEnvelope } from "./db/events.js";
import { findLiveSession } from "./db/sessions.js";
import { resolveSessionTeam, COOKIE_NAME, hashToken } from "./auth.js";
import type { ServerConfig } from "./config.js";
import type { SubmitOutcome, TeamLocks } from "./game.js";

/**
 * WebSocket transport (§12). JSON messages validated with Zod; one team room
 * per connection; events after lastSeq are replayed on reconnect (batched);
 * max message 64 KB; 20 actions/second per connection (sliding window, close
 * on abuse); broadcasts only ever reach the SAME team.
 */

export const MAX_WS_PAYLOAD = 64 * 1024;
export const MAX_ACTIONS_PER_SECOND = 20;
const REPLAY_BATCH = 100;
/** A socket that never authenticates is closed after this long. */
export const WS_HELLO_TIMEOUT_MS = 10_000;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Origin gate for browser socket auth (cookie-based hello). Non-browser
 * clients send no Origin and authenticate with an explicit Bearer token.
 * Allowed: exact same host as the request, the configured public origin, or —
 * only while the server itself is local (dev) — any localhost port (vite dev
 * proxy). Closed everywhere in production.
 */
export function isAllowedWsOrigin(
  origin: string | undefined,
  host: string | undefined,
  publicOrigin: string
): boolean {
  if (origin === undefined) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  if (host !== undefined && originHost === host.toLowerCase()) return true;
  try {
    if (originHost === new URL(publicOrigin).host.toLowerCase()) return true;
  } catch {
    /* malformed publicOrigin — fall through to the dev check */
  }
  const publicHost = new URL(publicOrigin).host.toLowerCase().split(":")[0] ?? "";
  const originHostname = originHost.split(":")[0] ?? "";
  return LOCAL_HOSTNAMES.has(publicHost) && LOCAL_HOSTNAMES.has(originHostname);
}

/** Live sockets per session-token hash, so logout can revoke open sockets. */
export interface SessionSockets {
  add(tokenHash: string, socket: WebSocket): void;
  remove(tokenHash: string, socket: WebSocket): void;
  closeAll(tokenHash: string): void;
}

export function createSessionSockets(): SessionSockets {
  const registry = new Map<string, Set<WebSocket>>();
  return {
    add(tokenHash, socket) {
      let set = registry.get(tokenHash);
      if (set === undefined) {
        set = new Set();
        registry.set(tokenHash, set);
      }
      set.add(socket);
    },
    remove(tokenHash, socket) {
      const set = registry.get(tokenHash);
      if (set === undefined) return;
      set.delete(socket);
      if (set.size === 0) registry.delete(tokenHash);
    },
    closeAll(tokenHash) {
      const set = registry.get(tokenHash);
      if (set === undefined) return;
      for (const socket of set) {
        if (socket.readyState === socket.OPEN) socket.close(1008, "session revoked");
      }
      registry.delete(tokenHash);
    },
  };
}

export interface WsContext {
  db: Db;
  locks: TeamLocks;
  config: ServerConfig;
  /** Shared team rooms: the same registry REST broadcasts use. */
  rooms: TeamRooms;
  /** Live sockets per session hash: logout closes them (revocation). */
  sessionSockets: SessionSockets;
  getBundle(worldId: string): WorldBundle | undefined;
  /** Applies one action through the shared write path and broadcasts its events. */
  submit(input: { teamId: string; bundle: WorldBundle; action: Action; actor: Actor }): Promise<SubmitOutcome>;
  /** Test seam: hello deadline in ms (default WS_HELLO_TIMEOUT_MS). */
  helloTimeoutMs?: number;
}

export interface TeamRooms {
  join(teamId: string, socket: WebSocket): void;
  leave(teamId: string, socket: WebSocket): void;
  sockets(teamId: string): IterableIterator<WebSocket>;
}

export function createRooms(): TeamRooms {
  const rooms = new Map<string, Set<WebSocket>>();
  return {
    join(teamId, socket) {
      let set = rooms.get(teamId);
      if (set === undefined) {
        set = new Set();
        rooms.set(teamId, set);
      }
      set.add(socket);
    },
    leave(teamId, socket) {
      const set = rooms.get(teamId);
      if (set === undefined) return;
      set.delete(socket);
      if (set.size === 0) rooms.delete(teamId);
    },
    *sockets(teamId) {
      const set = rooms.get(teamId);
      if (set !== undefined) yield* set;
    },
  };
}

/** Sends {t:"events"} envelopes to every connection in a team's room. */
export function broadcastToTeam(rooms: TeamRooms, teamId: string, envelopes: EventEnvelope[]): void {
  if (envelopes.length === 0) return;
  const msg: ServerMsgType = { t: "events", events: envelopes, seq: envelopes[envelopes.length - 1]!.seq };
  const payload = JSON.stringify(ServerMsg.parse(msg));
  for (const socket of rooms.sockets(teamId)) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

interface ConnState {
  teamId: string | undefined;
  userId: string | undefined;
  sessionTokenHash: string | undefined;
  bundle: WorldBundle | undefined;
  actionTimes: number[];
}

export async function registerWebsocket(app: FastifyInstance, ctx: WsContext): Promise<void> {
  await app.register(websocket, { options: { maxPayload: MAX_WS_PAYLOAD } });

  const rooms = ctx.rooms;

  const send = (socket: WebSocket, msg: ServerMsgType): void => {
    socket.send(JSON.stringify(ServerMsg.parse(msg)));
  };

  const forget = (conn: ConnState, socket: WebSocket): void => {
    if (conn.teamId !== undefined) rooms.leave(conn.teamId, socket);
    if (conn.sessionTokenHash !== undefined) ctx.sessionSockets.remove(conn.sessionTokenHash, socket);
  };

  const close = (conn: ConnState, socket: WebSocket, code: number, reason: string): void => {
    forget(conn, socket);
    socket.close(code, reason.slice(0, 100));
  };

  app.get("/ws", { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    const conn: ConnState = {
      teamId: undefined,
      userId: undefined,
      sessionTokenHash: undefined,
      bundle: undefined,
      actionTimes: [],
    };

    // Authentication deadline: an unauthenticated socket consumes a connection
    // slot forever otherwise. Idle keepalive pings do not satisfy hello.
    const helloTimer = setTimeout(() => {
      if (conn.teamId === undefined) socket.close(1008, "hello timeout");
    }, ctx.helloTimeoutMs ?? WS_HELLO_TIMEOUT_MS);

    socket.on("message", (raw: unknown) => {
      handle(raw).catch(() => close(conn, socket, 1011, "internal error"));
    });
    socket.on("close", () => {
      clearTimeout(helloTimer);
      forget(conn, socket);
    });
    socket.on("error", () => {
      clearTimeout(helloTimer);
      forget(conn, socket);
    });

    const closeConn = (code: number, reason: string): void => close(conn, socket, code, reason);

    async function handle(raw: unknown): Promise<void> {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(String(raw));
      } catch {
        return closeConn(1002, "invalid json");
      }
      const parsed = ClientMsg.safeParse(parsedJson);
      if (!parsed.success) return closeConn(1008, "invalid message");

      const msg = parsed.data;
      if (msg.t === "ping") {
        send(socket, { t: "pong" });
        return;
      }

      if (msg.t === "hello") {
        if (conn.teamId !== undefined) return closeConn(1008, "already authenticated");
        if (!isAllowedWsOrigin(request.headers.origin, request.headers.host, ctx.config.publicOrigin)) {
          return closeConn(1008, "origin not allowed");
        }
        // Explicit Bearer-style token first; an empty token means browser
        // cookie auth: the signed session cookie rode in on the upgrade
        // request and is validated server-side (never exposed to page JS).
        let token = msg.sessionToken;
        if (token === "") {
          const rawCookie = request.cookies[COOKIE_NAME];
          const unsigned = rawCookie === undefined ? undefined : request.unsignCookie(rawCookie);
          if (unsigned === undefined || !unsigned.valid || typeof unsigned.value !== "string") {
            return closeConn(1008, "unauthorized");
          }
          token = unsigned.value;
        }
        const session = await findLiveSession(ctx.db, hashToken(token));
        if (session === undefined) return closeConn(1008, "unauthorized");
        const team = await resolveSessionTeam(ctx.db, session);
        if (team === undefined) return closeConn(1008, "no team");
        const bundle = ctx.getBundle(team.worldId);
        if (bundle === undefined || bundle.bundleHash !== team.bundleHash) {
          return closeConn(1011, "world unavailable");
        }
        conn.teamId = team.id;
        conn.userId = session.user.id;
        conn.sessionTokenHash = session.session.tokenHash;
        conn.bundle = bundle;
        ctx.sessionSockets.add(session.session.tokenHash, socket);
        clearTimeout(helloTimer);
        // Logout raced the hello: the sweep ran before we registered. Re-check
        // and close, so a revoked session never keeps a live socket.
        if ((await findLiveSession(ctx.db, session.session.tokenHash)) === undefined) {
          return closeConn(1008, "session revoked");
        }

        // Join first, then replay under the team lock: action broadcasts run
        // under the same lock, so nothing is lost or duplicated in between.
        await ctx.locks.run(team.id, async () => {
          rooms.join(team.id, socket);
          const current = (await nextSeq(ctx.db, team.id)) - 1;
          send(socket, { t: "welcome", seq: current });
          const pending = await readAfter(ctx.db, team.id, msg.lastSeq);
          for (let i = 0; i < pending.length; i += REPLAY_BATCH) {
            const batch = pending.slice(i, i + REPLAY_BATCH);
            send(socket, { t: "events", events: batch, seq: batch[batch.length - 1]!.seq });
          }
        });
        return;
      }

      // msg.t === "action"
      if (conn.teamId === undefined || conn.userId === undefined || conn.bundle === undefined) {
        return closeConn(1008, "hello required");
      }
      const now = Date.now();
      conn.actionTimes = conn.actionTimes.filter((ts) => now - ts < 1000);
      conn.actionTimes.push(now);
      if (conn.actionTimes.length > MAX_ACTIONS_PER_SECOND) {
        return closeConn(1008, "action rate exceeded");
      }
      const outcome = await ctx.submit({
        teamId: conn.teamId,
        bundle: conn.bundle,
        action: msg.action,
        actor: { userId: conn.userId, kind: "human" },
      });
      send(socket, {
        t: "result",
        clientId: msg.clientId,
        ...(outcome.result !== undefined ? { result: outcome.result } : {}),
        ...(outcome.rejection !== undefined ? { rejection: outcome.rejection } : {}),
      });
    }
  });
}
