import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBundles } from '../src/bundles.js';
import { FIXTURE_WORLDS_DIR, postgresUp } from './helpers.js';

const pgUp = await postgresUp();

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

describe.skipIf(!pgUp)('tampered bundle reference validation', () => {
  it('rejects rehashed bundles with dangling report, terminal, event or visibility references', async () => {
    const dir = await mkdtemp(join(process.cwd(), 'test/bundle-refs-'));
    try {
      const original = JSON.parse(await readFile(join(FIXTURE_WORLDS_DIR, 'fixture@0.1.0.json'), 'utf8'));
      const terminalHost = original.world.hosts.find((h: { service: string }) => h.service === 'terminal').host;
      const variants: Array<Record<string, unknown>> = [
        { ...structuredClone(original), gates: [...original.gates, { id: 'g.bad-report', title: 'x', check: { kind: 'report', report: 'r.nonexistent' }, unlocks: [], score: 1 }] },
        { ...structuredClone(original), gates: [...original.gates, { id: 'g.bad-read', title: 'x', check: { kind: 'terminal', host: terminalHost, mustHaveRead: ['missing-world-file.txt'] }, unlocks: [], score: 1 }] },
        { ...structuredClone(original), events: [...original.events, { id: 'e.bad-reveal', trigger: { kind: 'at', time: '2026-11-02T00:00:00Z' }, effects: [{ kind: 'reveal', artifact: 'a.nonexistent' }] }] },
        { ...structuredClone(original), artifacts: original.artifacts.map((a: { id: string }, i: number) => i === 0 ? { ...a, visibility: { gateSolved: 'g.nonexistent' } } : a) },
        { ...structuredClone(original), assets: [...original.assets, { id: 'not-a-hash', sha256: 'not-a-hash', bytes: 1024 ** 3, contentType: 'text/html' }] },
      ];
      for (const [i, variant] of variants.entries()) {
        delete variant.bundleHash;
        variant.bundleHash = createHash('sha256').update(stable(variant)).digest('hex');
        const tampered = join(dir, `tampered-${i}.json`);
        await writeFile(tampered, JSON.stringify(variant));
        await expect(loadBundles(dir), `variant ${i}`).rejects.toThrow();
        await rm(tampered);
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
