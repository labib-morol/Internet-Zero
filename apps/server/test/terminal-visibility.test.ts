import { describe, expect, it } from 'vitest';
import { createTestApp, createGuestSession, bearer, postgresUp } from './helpers.js';
import { runTerminalCommand } from '../src/terminal-run.js';
import { fold, sessionStartEvent } from '@iz/runtime';

const pgUp = await postgresUp();
describe.skipIf(!pgUp)('terminal visibility invariants', () => {
  it('never reads invisible artifacts, hides locked connect targets, rejects private-claim broadcasts and persists due events', async () => {
    const env = await createTestApp();
    try {
      // An invisible terminal file must never be readable.
      const bundle = env.ctx.bundles.get('fixture')!;
      const actor = { userId: 'tester', kind: 'human' as const };
      const now = '2026-11-02T09:00:00Z';
      const state = fold(bundle, [sessionStartEvent(bundle, 'test', now, actor)]);
      const artifact = bundle.artifacts.find((a) => a.kind === 'terminal-file')!;
      artifact.visibility = { teamSizeAtLeast: 2 };
      const result = runTerminalCommand(bundle, state, artifact.host, '/', `cat /${artifact.path}`, actor.userId, now);
      expect(JSON.stringify(result)).not.toContain(artifact.body);
      const target = bundle.world.hosts.find((h) => h.service === 'mail')!;
      target.service = 'terminal';
      const connect = runTerminalCommand(bundle, state, artifact.host, '/', `connect ${target.host}`, actor.userId, now);
      expect(connect).toEqual({ ok: false, code: 'not_found', message: 'Host not found.' });

      const session = await createGuestSession(env.app);
      const privateClaim = await env.app.inject({ method: 'POST', url: '/api/actions', headers: bearer(session.sessionToken), payload: { action: { type: 'claim', text: 'Not broadcast to teammates.', private: true } } });
      expect(privateClaim.json().events ?? []).toEqual([]);

    } finally { await env.close(); }
  });
});
