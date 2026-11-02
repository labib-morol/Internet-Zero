import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app-context.js';
import { generateToken, hashToken } from '../auth.js';
import { createAgentToken, revokeAgentToken } from '../db/agent-tokens.js';
import { agentTokens } from '../db/schema.js';

export function registerAgentTokenRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/agent-tokens', async (request, reply) => {
    const auth = request.auth;
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = z.strictObject({ label: z.string().min(1).max(80) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid label' });
    const token = generateToken();
    const row = await createAgentToken(ctx.db, { teamId: auth.team.id, userId: auth.user.id, tokenHash: hashToken(token), label: parsed.data.label });
    return reply.code(201).send({ id: row.id, token });
  });
  app.get('/api/agent-tokens', async (request, reply) => {
    const auth = request.auth;
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const rows = await ctx.db.select({ id: agentTokens.id, label: agentTokens.label, revokedAt: agentTokens.revokedAt }).from(agentTokens)
      .where(and(eq(agentTokens.teamId, auth.team.id), eq(agentTokens.userId, auth.user.id)));
    return { tokens: rows };
  });
  app.delete<{ Params: { id: string } }>('/api/agent-tokens/:id', async (request, reply) => {
    const auth = request.auth;
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    await revokeAgentToken(ctx.db, auth.team.id, auth.user.id, request.params.id);
    return { revoked: true };
  });
}
