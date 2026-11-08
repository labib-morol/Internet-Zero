import type { FastifyInstance } from "fastify";
import { HealthResponse, ReadyResponse } from "@iz/schema";
import { sql } from "drizzle-orm";
import type { AppContext } from "../app-context.js";
import { migrationsCurrent } from "../db/migrate.js";

async function probeDatabase(ctx: AppContext, expectedMigrations: number): Promise<{
  database: boolean;
  migrations: boolean;
}> {
  try {
    await ctx.db.execute(sql`select 1`);
    return { database: true, migrations: await migrationsCurrent(ctx.db, expectedMigrations) };
  } catch {
    return { database: false, migrations: false };
  }
}

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext, expectedMigrations: number): void {
  app.get("/healthz", async () => HealthResponse.parse({ ok: true }));

  app.get("/readyz", async (_request, reply) => {
    const { database, migrations } = await probeDatabase(ctx, expectedMigrations);
    const bundlesLoaded = ctx.bundles.size;
    const ready = database && migrations && bundlesLoaded >= 1;
    const body = ReadyResponse.parse({
      ready,
      database,
      migrationsCurrent: migrations,
      bundlesLoaded,
    });
    // Orchestrators (Render health checks, compose) act on the STATUS CODE:
    // an unready instance must be 503, never a 200 with ready:false.
    if (!ready) return reply.code(503).send(body);
    return body;
  });
}
