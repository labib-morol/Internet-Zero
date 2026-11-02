import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestApp, createGuestSession, bearer, postgresUp } from './helpers.js';
import { readFile } from 'node:fs/promises';

const pgUp = await postgresUp();

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

describe.skipIf(!pgUp)('rejected terminal actions keep due world events', () => {
  it('persists WorldEventFired even when the terminal command itself is rejected', async () => {
    const worldsDir = await mkdtemp(join(process.cwd(), 'test/due-world-'));
    try {
      const bundle = JSON.parse(await readFile(join('test/fixtures/worlds', 'fixture@0.1.0.json'), 'utf8'));
      bundle.events = [...bundle.events, { id: 'e.reveal-due', trigger: { kind: 'at', time: '2026-11-01T00:00:00Z' }, effects: [{ kind: 'revealHosts', hosts: ['term.fix.pcp'] }] }];
      delete bundle.bundleHash;
      bundle.bundleHash = createHash('sha256').update(stable(bundle)).digest('hex');
      await writeFile(join(worldsDir, 'fixture@0.1.0.json'), JSON.stringify(bundle));

      const env = await createTestApp({ worldsDir });
      try {
        const session = await createGuestSession(env.app, 'fixture');
        const due = await env.app.inject({
          method: 'POST', url: '/api/actions', headers: bearer(session.sessionToken),
          payload: { action: { type: 'terminal', host: 'term.fix.pcp', cwd: '/', line: 'connect unknown.iz' } },
        });
        expect(due.statusCode).toBe(200);
        expect(due.json().rejection?.code).toBe('not_found');
        const persisted = await env.app.inject({ method: 'GET', url: '/api/state', headers: bearer(session.sessionToken) });
        expect(persisted.json().state.firedEvents).toContain('e.reveal-due');
      } finally { await env.close(); }
    } finally { await rm(worldsDir, { recursive: true, force: true }); }
  });
});
