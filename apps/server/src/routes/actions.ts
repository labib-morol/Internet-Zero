import type { FastifyInstance } from "fastify";
import { SubmitActionRequest, SubmitActionResponse, type GameEvent } from "@iz/schema";
import type { AppContext } from "../app-context.js";

/**
 * POST /api/actions (§19.3): the single write path. Validates the body with
 * the frozen Action schema, applies through @iz/runtime, appends with the
 * optimistic retry (§12) and broadcasts the events to the team's WebSocket
 * connections.
 */
export function registerActionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/actions", async (request, reply) => {
    const body = SubmitActionRequest.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_action" });
    }
    const auth = request.auth;
    if (auth === undefined) return reply.code(401).send({ error: "unauthorized" });
    const bundle = ctx.bundles.get(auth.team.worldId);
    if (bundle === undefined || bundle.bundleHash !== auth.team.bundleHash) {
      return reply.code(409).send({ error: "world build no longer matches the team" });
    }
    const outcome = await ctx.submit({
      teamId: auth.team.id,
      bundle,
      action: body.data.action,
      actor: { userId: auth.user.id, kind: "human" },
    });
    return SubmitActionResponse.parse({
      ...(outcome.result !== undefined ? { result: outcome.result } : {}),
      ...(outcome.rejection !== undefined ? { rejection: outcome.rejection } : {}),
      events: outcome.events.map((envelope) => envelope.event as GameEvent),
    });
  });
}
