import { describe, expect, it } from 'vitest';
import { readAll } from '../src/db/events.js';
import { createTestApp, createGuestSession, bearer, postgresUp, listen } from './helpers.js';
import { scoreRun, runTutorialOracle } from '@iz/agent-runner';

const pgUp = await postgresUp();
describe.skipIf(!pgUp)('official MCP client tutorial benchmark', () => {
  it('completes real tool calls, records agent events and scores the ending', async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app, 'tutorial');
      const created = await env.app.inject({ method: 'POST', url: '/api/agent-tokens', headers: bearer(session.sessionToken), payload: { label: 'oracle' } });
      const { httpUrl } = await listen(env.app);
      const run = await runTutorialOracle(`${httpUrl}/mcp`.replace('127.0.0.1', 'localhost'), created.json().token);
      const events = (await readAll(env.ctx.db, session.teamId)).map((row) => row.event);
      const metrics = scoreRun(env.ctx.bundles.get('tutorial')!, events, 'oracle', run.toolCalls);
      expect(metrics.completed).toBe(true);
      expect(metrics.gatesSolved).toBe(3);
      expect(metrics.requiredFactsEvidenced).toBe(metrics.requiredFactsTotal);
      expect(events.filter((event) => event.type !== 'SessionStarted').every((event) => event.actorKind === 'agent')).toBe(true);
      expect(events.some((event) => event.type === 'TerminalRead' && event.path === '/etc/motd')).toBe(true);
      const saved = await env.app.inject({ method: 'POST', url: '/api/benchmarks', headers: bearer(session.sessionToken), payload: { label: 'oracle', toolCalls: run.toolCalls } });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().metrics.completed).toBe(true);
      const replay = await env.app.inject({ method: 'GET', url: '/api/benchmarks', headers: bearer(session.sessionToken) });
      expect(replay.json().runs[0].metrics).toMatchObject({ completed: true, gatesSolved: 3 });
    } finally { await env.close(); }
  }, 60000);
});
