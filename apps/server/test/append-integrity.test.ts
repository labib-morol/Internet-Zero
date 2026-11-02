import { describe, it, expect } from 'vitest';
import { append, readAll } from '../src/db/events.js';
import { createTestApp, createGuestSession, postgresUp } from './helpers.js';

const pgUp = await postgresUp();
describe.skipIf(!pgUp)('event append transaction integrity', () => {
  it('never persists an uncontended suffix when a batch overlaps an existing event', async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);
      const before = await readAll(env.ctx.db, session.teamId);
      const base = { at: '2026-11-02T09:00:00Z', by: session.userId, actorKind: 'human' as const };
      const result = await append(env.ctx.db, session.teamId, 1, [
        { type: 'ClaimCreated', claimId: 'cl.overlap', text: 'overlap', private: false, ...base },
        { type: 'ClaimCreated', claimId: 'cl.suffix', text: 'must roll back', private: false, ...base },
      ]);
      expect(result.ok).toBe(false);
      expect(await readAll(env.ctx.db, session.teamId)).toEqual(before);
    } finally { await env.close(); }
  });
});
