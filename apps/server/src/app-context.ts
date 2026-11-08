import type { Actor, WorldBundle } from "@iz/schema";
import type { Db } from "./db/client.js";
import type { BundleRegistry } from "./bundles.js";
import type { TeamLocks, SubmitOutcome } from "./game.js";
import type { ServerConfig } from "./config.js";
import type { SessionSockets, TeamRooms } from "./ws.js";
import type { Action } from "@iz/schema";

/**
 * The application context shared by routes and the WebSocket transport.
 * Deliberately I/O-only: all game logic lives in @iz/runtime (AGENTS.md).
 */
export interface AppContext {
  config: ServerConfig;
  db: Db;
  bundles: BundleRegistry;
  locks: TeamLocks;
  clock: { now(): string };
  rooms: TeamRooms;
  /** Live sockets per session hash: logout closes them (revocation). */
  sessionSockets: SessionSockets;
  submit(input: { teamId: string; bundle: WorldBundle; action: Action; actor: Actor }): Promise<SubmitOutcome>;
}

declare module "fastify" {
  interface FastifyInstance {
    /** Application context (db, bundles, locks, rooms). */
    iz: AppContext;
  }
}
