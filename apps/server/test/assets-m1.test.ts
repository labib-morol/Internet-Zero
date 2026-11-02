import { describe, it, expect } from 'vitest';
import { createGuestSession, createTestApp, bearer, postgresUp } from './helpers.js';

const pgUp = await postgresUp();
describe.skipIf(!pgUp)('self-hosted application and content assets', () => {
  it('serves the compiled SPA without exposing any bundle', async () => {
    const env = await createTestApp();
    try {
      expect((await env.app.inject({ method: 'GET', url: '/' })).body).toContain('<div id="root">');
      expect((await env.app.inject({ method: 'GET', url: '/dist/worlds/fixture@0.1.0.json' })).statusCode).toBe(404);
    } finally { await env.close(); }
  });
  it('authorizes content-hash assets only when visible to the team', async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);
      const bundle = env.ctx.bundles.get('fixture')!;
      const asset = bundle.assets[0]!;
      const owners = bundle.artifacts.filter((a) => JSON.stringify(a).includes(asset.id));
      for (const owner of owners) {
        const host = bundle.world.hosts.find((h) => h.host === owner.host)!;
        host.requires = undefined;
        owner.visibility = undefined;
      }
      const response = await env.app.inject({ method: 'GET', url: `/api/assets/${asset.sha256}`, headers: bearer(session.sessionToken) });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain(asset.contentType);
      expect(response.rawPayload.length).toBe(asset.bytes);
      for (const bad of ['../world.yaml', '%2e%2e', 'x'.repeat(64)]) {
        expect((await env.app.inject({ method: 'GET', url: `/api/assets/${bad}`, headers: bearer(session.sessionToken) })).statusCode).not.toBe(200);
      }
      expect((await env.app.inject({ method: 'GET', url: `/api/assets/${asset.sha256}` })).statusCode).toBe(401);
      for (const owner of owners) owner.visibility = { teamSizeAtLeast: 2 };
      expect((await env.app.inject({ method: 'GET', url: `/api/assets/${asset.sha256}`, headers: bearer(session.sessionToken) })).statusCode).toBe(404);
    } finally { await env.close(); }
  });
});
