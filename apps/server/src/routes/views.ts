import type { FastifyInstance } from "fastify";
import { forgeView, forgeCollectibles, mailView, mailCollectibles, archiveView, archiveCollectibles, terminalView, terminalCollectibles, forumView, forumCollectibles } from "@iz/services";
import type { ViewModel } from "@iz/schema";
import type { AppContext } from "../app-context.js";
import { loadTeamState } from "../game.js";
import { hostReachable } from '@iz/runtime';

/**
 * GET /api/view?host=&path= (M1): the visible view model for a host+path in
 * the calling team's current state. The service modules enforce visibility
 * internally (aggregating views filter members); locked pages are
 * indistinguishable from missing ones (§10.1). Collectibles are attached so
 * the client can offer evidence collection without re-deriving anything.
 */
const COLLECTIBLE_LABELS: Record<string, (v: ViewModel) => ReturnType<typeof forgeCollectibles>> = {
  forge: forgeCollectibles,
  mail: mailCollectibles,
  archive: archiveCollectibles,
  terminal: terminalCollectibles,
  forum: forumCollectibles,
};

export function registerViewRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/view", async (request, reply) => {
    const auth = request.auth;
    if (auth === undefined) return reply.code(401).send({ error: "unauthorized" });
    const bundle = ctx.bundles.get(auth.team.worldId);
    if (bundle === undefined || bundle.bundleHash !== auth.team.bundleHash) {
      return reply.code(409).send({ error: "world build no longer matches the team" });
    }
    const host = String((request.query as Record<string, unknown>).host ?? "");
    const path = String((request.query as Record<string, unknown>).path ?? "/");
    const hostDef = bundle.world.hosts.find((h) => h.host === host);
    if (hostDef === undefined) {
      // Unknown and locked hosts are indistinguishable (§10.1).
      return { view: { notFound: true, host, path }, collectibles: [] };
    }
    const { state } = await loadTeamState(ctx.db, bundle, auth.team.id);
    const now = new Date().toISOString();
    if (!hostReachable(bundle, hostDef, state, (id) => state.unlocked.has(id), now)) {
      return { view: { notFound: true, host, path }, collectibles: [] };
    }
    let view: ViewModel;
    switch (hostDef.service) {
      case "forge":
        view = forgeView(bundle, state, host, path, now);
        break;
      case "mail":
        view = mailView(bundle, state, host, path, now);
        break;
      case "archive":
        view = archiveView(bundle, state, host, path, now);
        break;
      case "terminal":
        view = terminalView(bundle, state, host, path, now);
        break;
      case "forum":
        view = forumView(bundle, state, host, path, now);
        break;
      default:
        view = { notFound: true, host, path };
    }
    const collectibles = COLLECTIBLE_LABELS[hostDef.service]?.(view) ?? [];
    return { view, collectibles };
  });
}
