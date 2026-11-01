import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "@fastify/websocket";
import type { Action, Actor, ServerMsg as ServerMsgType, WorldBundle } from "@iz/schema";
import { ClientMsg, ServerMsg } from "@iz/schema";
import type { Db } from "./db/client.js";
import { nextSeq, readAfter } from "./db/events.js";
import type { EventEnvelope } from "./db/events.js";
import { findLiveSession } from "./db/sessions.js";
import { firstTeamForUser } from "./db/teams.js";
import { hashToken } from "./auth.js";
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

export interface WsContext {
  db: Db;
  locks: TeamLocks;
  /** Shared team rooms: the same registry REST broadcasts use. */
  rooms: TeamRooms;
  getBundle(worldId: string): WorldBundle | undefined;
  /** Applies one action through the shared write path and broadcasts its events. */
  submit(input: { teamId: string; bundle: WorldBundle; action: Action; actor: Actor }): Promise<SubmitOutcome>;
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
  bundle: WorldBundle | undefined;
  actionTimes: number[];
}

export async function registerWebsocket(app: FastifyInstance, ctx: WsContext): Promise<void> {
  await app.register(websocket, { options: { maxPayload: MAX_WS_PAYLOAD } });

  const rooms = ctx.rooms;

  const send = (socket: WebSocket, msg: ServerMsgType): void => {
    socket.send(JSON.stringify(ServerMsg.parse(msg)));
  };

  const close = (conn: ConnState, socket: WebSocket, code: number, reason: string): void => {
    if (conn.teamId !== undefined) rooms.leave(conn.teamId, socket);
    socket.close(code, reason.slice(0, 100));
  };

  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    const conn: ConnState = { teamId: undefined, userId: undefined, bundle: undefined, actionTimes: [] };

    socket.on("message", (raw: unknown) => {
      handle(raw).catch(() => close(conn, socket, 1011, "internal error"));
    });
    socket.on("close", () => {
      if (conn.teamId !== undefined) rooms.leave(conn.teamId, socket);
    });
    socket.on("error", () => {
      if (conn.teamId !== undefined) rooms.leave(conn.teamId, socket);
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
        const session = await findLiveSession(ctx.db, hashToken(msg.sessionToken));
        if (session === undefined) return closeConn(1008, "unauthorized");
        const team = await firstTeamForUser(ctx.db, session.user.id);
        if (team === undefined) return closeConn(1008, "no team");
        const bundle = ctx.getBundle(team.worldId);
        if (bundle === undefined || bundle.bundleHash !== team.bundleHash) {
          return closeConn(1011, "world unavailable");
        }
        conn.teamId = team.id;
        conn.userId = session.user.id;
        conn.bundle = bundle;

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
