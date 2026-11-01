import type { FastifyInstance } from "fastify";
import { ListWorldsResponse, WorldSummary } from "@iz/schema";
import type { AppContext } from "../app-context.js";

/** GET /api/worlds (§19.3). Auth required; canon never leaves the server. */
export function registerWorldsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/worlds", async () => {
    const worlds = WorldSummary.array().parse(
      ctx.bundles.list().map((bundle) => ({
        worldId: bundle.world.id,
        title: bundle.world.title,
        summary: bundle.world.summary,
        version: bundle.world.version,
        bundleHash: bundle.bundleHash,
        entry: bundle.world.entry,
        hosts: bundle.world.hosts.map((h) => ({
          host: h.host,
          service: h.service,
          title: h.title ?? h.host,
        })),
      }))
    );
    return ListWorldsResponse.parse({ worlds });
  });
}
