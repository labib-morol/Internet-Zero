import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssetIndex } from './assets.js';

export async function emitAssets(sourceDir: string, outDir: string, index: AssetIndex): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const asset of index.records) {
    const source = [...index.byKey.entries()].find(([key, record]) => key.includes('/') && record.id === asset.id)?.[0];
    if (!source) throw new Error(`Asset source not found: ${asset.id}`);
    const bytes = await readFile(join(sourceDir, source));
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Asset changed during compilation.');
    await writeFile(join(outDir, asset.sha256), bytes);
  }
}
