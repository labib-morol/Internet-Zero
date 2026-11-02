import type { FastifyInstance } from "fastify";
import { ListWorldsResponse, WorldSummary } from "@iz/schema";
import type { AppContext } from "../app-context.js";
import { hostReachable } from '@iz/runtime';
import { loadTeamState } from '../game.js';

/** GET /api/worlds (§19.3). Auth required; canon never leaves the server. */
export function registerWorldsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/worlds", async (request, reply) => {
    if (request.auth === undefined) return reply.code(401).send({ error: 'unauthorized' });
    const current = ctx.bundles.get(request.auth.team.worldId);
    if (current === undefined) return reply.code(404).send({ error: 'world not found' });
    const { state } = await loadTeamState(ctx.db, current, request.auth.team.id);
    const now = new Date().toISOString();
    const worlds = WorldSummary.array().parse(
      [current].map((bundle) => ({
        worldId: bundle.world.id,
        title: bundle.world.title,
        summary: bundle.world.summary,
        version: bundle.world.version,
        bundleHash: bundle.bundleHash,
        entry: bundle.world.entry,
        hosts: bundle.world.hosts.filter((h) => hostReachable(bundle, h, state, (id) => state.unlocked.has(id), now)).map((h) => ({
          host: h.host,
          service: h.service,
          title: h.title ?? h.host,
        })),
      }))
    );
    return ListWorldsResponse.parse({ worlds });
  });
}
