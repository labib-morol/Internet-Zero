import type { FastifyInstance } from 'fastify';
import { hostHeaderValidation } from '@modelcontextprotocol/fastify';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createGameMcpServer } from '@iz/mcp';
import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { hashToken } from '../auth.js';
import { findLiveAgentToken, touchAgentToken } from '../db/agent-tokens.js';
import { teamMembers, teams } from '../db/schema.js';
import { gameToolBridge } from '../mcp-bridge.js';

export async function registerMcpRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const counts = new Map<string, number[]>();
  const bridges = new Map<string, ReturnType<typeof gameToolBridge>>();
  await app.register(async (mcp) => {
    mcp.addHook('onRequest', hostHeaderValidation([new URL(ctx.config.publicOrigin).hostname]));
    mcp.post('/mcp', async (request, reply) => {
      const raw = request.headers.authorization;
      const token = typeof raw === 'string' && raw.startsWith('Bearer ') ? raw.slice(7) : undefined;
      const record = token ? await findLiveAgentToken(ctx.db, hashToken(token)) : undefined;
      if (!record) return reply.code(401).send({ error: 'unauthorized' });
      const memberships = await ctx.db.select().from(teamMembers).where(and(eq(teamMembers.teamId, record.teamId), eq(teamMembers.userId, record.userId)));
      const team = (await ctx.db.select().from(teams).where(eq(teams.id, record.teamId)))[0];
      if (!memberships.length || !team) return reply.code(401).send({ error: 'unauthorized' });
      const body = request.body as { method?: string };
      if (body.method === 'tools/call') {
        const now = Date.now();
        const recent = (counts.get(record.id) ?? []).filter((at) => now - at < 60_000);
        if (recent.length >= 60) return reply.code(429).header('Retry-After', '60').send({ error: 'rate limited' });
        counts.set(record.id, [...recent, now]);
      }
      await touchAgentToken(ctx.db, record.teamId, record.id);
      let bridge = bridges.get(record.id);
      if (!bridge) { bridge = gameToolBridge(ctx, record.teamId, record.userId, team.worldId); bridges.set(record.id, bridge); }
      const server = createGameMcpServer(bridge);
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      reply.hijack();
      reply.raw.on('close', () => { void transport.close(); void server.close(); });
      await transport.handleRequest(request.raw, reply.raw, request.body);
    });
    for (const method of ['GET', 'DELETE'] as const) {
      mcp.route({ method, url: '/mcp', handler: async (_request, reply) => reply.code(405).send({ error: 'method not allowed' }) });
    }
  });
}
