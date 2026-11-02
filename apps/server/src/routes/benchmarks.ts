import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { scoreRun } from '@iz/agent-runner';
import type { AppContext } from '../app-context.js';
import { readAll } from '../db/events.js';
import { createBenchmarkRun, finishBenchmarkRun } from '../db/agent-tokens.js';
import { benchmarkRuns } from '../db/schema.js';

export function registerBenchmarkRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/benchmarks', async (request, reply) => {
    const auth = request.auth;
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const input = z.strictObject({ label: z.string().min(1).max(80), toolCalls: z.number().int().min(0) }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid run' });
    const bundle = ctx.bundles.get(auth.team.worldId);
    if (!bundle) return reply.code(404).send({ error: 'world unavailable' });
    const events = (await readAll(ctx.db, auth.team.id)).map((e) => e.event);
    const metrics = scoreRun(bundle, events, input.data.label, input.data.toolCalls);
    const run = await createBenchmarkRun(ctx.db, { teamId: auth.team.id, worldId: auth.team.worldId, agentLabel: input.data.label, startedAt: auth.team.startedAt });
    await finishBenchmarkRun(ctx.db, auth.team.id, run.id, { ...metrics });
    return { id: run.id, metrics };
  });
  app.get('/api/benchmarks', async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' });
    const rows = await ctx.db.select().from(benchmarkRuns).where(and(eq(benchmarkRuns.teamId, request.auth.team.id)));
    return { runs: rows.map((row) => ({ id: row.id, metrics: row.metrics })) };
  });
}
