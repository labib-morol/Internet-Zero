import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { visibleArtifacts } from '@iz/runtime';
import type { AppContext } from '../app-context.js';
import { loadTeamState } from '../game.js';

export function registerAssetRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const auth = request.auth;
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const id = request.params.id;
    if (!/^[0-9a-f]{64}$/.test(id)) return reply.code(404).send({ error: 'not found' });
    const bundle = ctx.bundles.get(auth.team.worldId);
    if (!bundle || bundle.bundleHash !== auth.team.bundleHash) return reply.code(409).send({ error: 'world mismatch' });
    const asset = bundle.assets.find((item) => item.sha256 === id);
    const { state } = await loadTeamState(ctx.db, bundle, auth.team.id);
    if (!asset || !visibleArtifacts(bundle, state, ctx.clock.now()).some((a) => JSON.stringify({ ast: a.ast, meta: a.meta }).includes(id))) {
      return reply.code(404).send({ error: 'not found' });
    }
    try {
      const bytes = await readFile(join(ctx.config.worldsDir, 'assets', id));
      if (createHash('sha256').update(bytes).digest('hex') !== id) return reply.code(404).send({ error: 'not found' });
      return reply.type(asset.contentType).header('Cache-Control', 'private, max-age=3600').send(bytes);
    } catch { return reply.code(404).send({ error: 'not found' }); }
  });
}
