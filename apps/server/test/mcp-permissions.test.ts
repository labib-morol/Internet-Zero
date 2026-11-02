import { describe, expect, it } from 'vitest';
import { createTestApp, createGuestSession, bearer, postgresUp } from './helpers.js';

const pgUp = await postgresUp();
describe.skipIf(!pgUp)('MCP permissions across every tool', () => {
  it('keeps locked data private, confines tokens, revokes and rate-limits tool calls', async () => {
    const env = await createTestApp({ requestsPerMinute: 500 });
    try {
      const a = await createGuestSession(env.app, 'tutorial');
      const b = await createGuestSession(env.app, 'tutorial');
      const tokenResponse = await env.app.inject({ method: 'POST', url: '/api/agent-tokens', headers: bearer(a.sessionToken), payload: { label: 'permissions' } });
      const token = tokenResponse.json().token as string;
      const id = tokenResponse.json().id as string;
      let seq = 1;
      const invoke = (name: string, args: Record<string, unknown>) => env.app.inject({ method: 'POST', url: '/mcp', headers: { ...bearer(token), host: 'localhost:8080', accept: 'application/json, text/event-stream' }, payload: { jsonrpc: '2.0', id: seq++, method: 'tools/call', params: { name, arguments: args } } });
      const cases: Array<[string, Record<string, unknown>]> = [
        ['iz_status', {}], ['iz_list_hosts', {}], ['iz_open', { url: 'mail.pinecone.pcp/mb.odile' }],
        ['iz_search', { query: 'hint' }], ['iz_inspect', { artifactId: 'a.m-hint' }],
        ['iz_terminal', { host: 'printer.pinecone.pcp', command: 'cat /etc/motd' }],
        ['iz_collect', { artifactId: 'a.m-hint' }], ['iz_claim', { text: 'An unsupported hypothesis.' }],
        ['iz_link', { from: 'foreign', to: 'foreign', relation: 'supports', confidence: 1 }],
        ['iz_submit_answer', { gateId: 'g.printer', answer: 'not-the-answer' }],
        ['iz_submit_report', { reportId: 'r.who-holds', groupId: 'A', slots: {} }],
        ['iz_request_hint', { gateId: 'g.printer', tier: 1 }],
      ];
      for (const [name, args] of cases) {
        const res = await invoke(name, args);
        expect(res.statusCode, name).toBe(200);
        for (const secret of ['"canon"', '"answerHashes"', '"bundleSalt"', 'name of the shop cat plus', '"proofs"', '"facts"']) expect(res.body, name).not.toContain(secret);
      }
      const other = await env.app.inject({ method: 'GET', url: '/api/state', headers: bearer(b.sessionToken) });
      expect(Object.keys(other.json().state.claims)).toEqual([]);
      expect(Object.keys(other.json().state.solvedGates)).toEqual([]);
      const injected = await invoke('iz_collect', { artifactId: 'a.office-scripts', teamId: b.teamId });
      expect(injected.body).toContain('error');
      for (let i = cases.length + 1; i < 60; i++) await invoke('iz_status', {});
      const limit = await invoke('iz_status', {});
      expect(limit.statusCode).toBe(429);
      const badHost = await env.app.inject({ method: 'POST', url: '/mcp', headers: { ...bearer(token), host: 'attacker.example', accept: 'application/json, text/event-stream' }, payload: {} });
      expect(badHost.statusCode).toBe(403);
      await env.app.inject({ method: 'DELETE', url: `/api/agent-tokens/${id}`, headers: bearer(b.sessionToken) });
      const stillLive = await env.app.inject({ method: 'POST', url: '/mcp', headers: { ...bearer(token), host: 'localhost:8080', accept: 'application/json, text/event-stream' }, payload: { jsonrpc: '2.0', id: 5, method: 'tools/list', params: {} } });
      expect(stillLive.statusCode).toBe(200);
      await env.app.inject({ method: 'DELETE', url: `/api/agent-tokens/${id}`, headers: bearer(a.sessionToken) });
      expect((await invoke('iz_status', {})).statusCode).toBe(401);
    } finally { await env.close(); }
  }, 60000);
});
