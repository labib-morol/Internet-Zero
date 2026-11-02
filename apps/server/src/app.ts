import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { Action, Actor, WorldBundle } from "@iz/schema";
import { loadBundles } from "./bundles.js";
import { type ServerConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { declaredMigrationCount, runMigrations } from "./db/migrate.js";
import { submitAction, TeamLocks } from "./game.js";
import { authGuard } from "./auth.js";
import { registerRateLimit, registerSecurityHeaders } from "./security.js";
import { broadcastToTeam, createRooms, registerWebsocket } from "./ws.js";
import type { AppContext } from "./app-context.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerWorldsRoutes } from "./routes/worlds.js";
import { registerStateRoutes } from "./routes/state.js";
import { registerActionRoutes } from "./routes/actions.js";
import { registerViewRoutes } from "./routes/views.js";
import { registerCaseRoutes } from "./routes/case.js";
import { registerNoteRoutes } from "./routes/notes.js";
import { registerAssetRoutes } from './routes/assets.js';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';

export interface BuildAppOptions {
  config: ServerConfig;
  /**
   * Migrations folder; defaults to <package>/drizzle resolved from this module
   * (works both from src via tsx and from dist).
   */
  migrationsFolder?: string;
  /** Run migrations at boot (default true; tests may pre-run them). */
  runMigrations?: boolean;
  /** Override the in-memory rate limit for tests. Default 120/min (§16). */
  requestsPerMinute?: number;
}

export const DEFAULT_REQUESTS_PER_MINUTE = 120;
export const REST_BODY_LIMIT = 256 * 1024;

/**
 * App factory (testable, does not listen). Loads bundles (invalid bundles fail
 * the boot), connects to Postgres, runs migrations, and wires REST + WS.
 */
export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const config = opts.config;
  const migrationsFolder = opts.migrationsFolder ?? fileURLToPath(new URL("../drizzle", import.meta.url));

  const bundles = await loadBundles(config.worldsDir);
  const { pool, db } = createDb(config.databaseUrl);

  const expectedMigrations = await declaredMigrationCount(migrationsFolder);
  if (opts.runMigrations !== false) {
    await runMigrations(db, migrationsFolder);
  }

  const app = fastify({
    bodyLimit: REST_BODY_LIMIT,
    genReqId: () => randomUUID(),
    logger: {
      level: config.logLevel,
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie"],
        censor: "[REDACTED]",
      },
    },
  });

  const locks = new TeamLocks();
  const clock = { now: () => new Date().toISOString() };
  const rooms = createRooms();
  const ctx: AppContext = {
    config,
    db,
    bundles,
    locks,
    clock,
    rooms,
    submit: (input: { teamId: string; bundle: WorldBundle; action: Action; actor: Actor }) =>
      submitAction({
        db,
        bundle: input.bundle,
        teamId: input.teamId,
        action: input.action,
        actor: input.actor,
        clock,
        locks,
        onBroadcast: (teamId, envelopes) => broadcastToTeam(rooms, teamId, envelopes),
      }),
  };

  app.decorate("iz", ctx);

  await app.register(cookie, { secret: config.sessionSecret });

  registerSecurityHeaders(app, { publicOrigin: config.publicOrigin });
  registerRateLimit(app, { requestsPerMinute: opts.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE });

  registerHealthRoutes(app, ctx, expectedMigrations);
  registerSessionRoutes(app, ctx);

  // Guarded subtree: everything under /api except session creation requires a
  // valid session (cookie or Bearer token).
  await app.register(async function guardedApi(api) {
    api.addHook("onRequest", async (request, reply) => {
      const auth = await authGuard(db, request, reply);
      if (auth !== undefined) request.auth = auth;
    });
    registerWorldsRoutes(api, ctx);
    registerStateRoutes(api, ctx);
    registerActionRoutes(api, ctx);
    registerViewRoutes(api, ctx);
    registerCaseRoutes(api, ctx);
    registerNoteRoutes(api, ctx);
    registerAssetRoutes(api, ctx);
  });

  await registerWebsocket(app, {
    db,
    locks,
    rooms,
    getBundle: (worldId) => bundles.get(worldId),
    submit: ctx.submit,
  });

  const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  if (existsSync(webRoot)) await app.register(staticFiles, { root: webRoot, prefix: '/' });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}

