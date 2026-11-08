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
    validated.state.claims = Object.fromEntries(Object.entries(validated.state.claims).filter(([, claim]) => !claim.private || claim.createdBy === auth.user.id));
    validated.state.links = Object.fromEntries(Object.entries(validated.state.links).filter(([, link]) =>
      (validated.state.evidence[link.from] || validated.state.claims[link.from]) && (validated.state.evidence[link.to] || validated.state.claims[link.to])));
    // Hints this team has ALREADY paid for (DECISIONS D28): the panel-local
    // hint list dies with the window, and re-requesting a purchased tier is
    // rejected — so purchased text rides with the authoritative state.
    // Unpurchased tiers are never included.
    const purchasedHints: Record<string, Array<{ tier: 1 | 2 | 3; text: string; cost: number }>> = {};
    for (const [gateId, usedTier] of Object.entries(validated.state.hintsUsed)) {
      const tiers = bundle.hints
        .filter((hint) => hint.gate === gateId && hint.tier <= usedTier)
        .map((hint) => ({ tier: hint.tier, text: hint.text, cost: hint.cost }));
      if (tiers.length > 0) purchasedHints[gateId] = tiers;
    }
    return {
      state: stateToWire(validated.state),
      ...(Object.keys(purchasedHints).length > 0 ? { purchasedHints } : {}),
    };
  });
}
