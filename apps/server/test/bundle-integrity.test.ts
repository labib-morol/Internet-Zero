import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBundles } from '../src/bundles.js';
import { FIXTURE_WORLDS_DIR } from './helpers.js';

describe('compiled bundle validation', () => {
  it('rejects tampered bundles and unsafe compiled AST URLs', async () => {
    const dir = await mkdtemp(join(process.cwd(), 'test/bundle-check-'));
    try {
      const bundle = JSON.parse(await readFile(join(FIXTURE_WORLDS_DIR, 'fixture@0.1.0.json'), 'utf8'));
      bundle.bundleHash = '0'.repeat(64);
      bundle.artifacts[0].ast = { type: 'link', url: 'javascript:alert(1)', children: [] };
      await writeFile(join(dir, 'tampered.json'), JSON.stringify(bundle));
      await expect(loadBundles(dir)).rejects.toThrow(/hash|unsafe|integrity/i);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
