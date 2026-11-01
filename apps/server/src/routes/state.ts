import type { FastifyInstance } from "fastify";
import { GetStateResponse } from "@iz/schema";
import type { AppContext } from "../app-context.js";
import { loadTeamState } from "../game.js";
import { stateToWire } from "../state-wire.js";

/**
 * GET /api/state (§19.3): the calling user's team state, folded from the event
 * log. Sets are serialized as sorted arrays (see state-wire.ts).
 */
export function registerStateRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/state", async (request, reply) => {
    const auth = request.auth;
    if (auth === undefined) return reply.code(401).send({ error: "unauthorized" });
    const bundle = ctx.bundles.get(auth.team.worldId);
    if (bundle === undefined || bundle.bundleHash !== auth.team.bundleHash) {
      return reply.code(409).send({ error: "world build no longer matches the team" });
    }
    const { state } = await loadTeamState(ctx.db, bundle, auth.team.id);
    // Validate the in-memory state against the frozen contract, then convert
    // Sets to arrays for the JSON wire form (state-wire.ts).
    const validated = GetStateResponse.parse({ state });
    return { state: stateToWire(validated.state) };
  });
}
