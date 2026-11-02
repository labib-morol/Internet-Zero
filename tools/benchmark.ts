import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runTutorialOracle } from '@iz/agent-runner';

const origin = process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080';
const session = await fetch(`${origin}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ worldId: 'tutorial' }) }).then(async (r) => { if (!r.ok) throw new Error('Session could not be created.'); return r.json() as Promise<{ sessionToken: string; teamId: string }> });
const headers = { authorization: `Bearer ${session.sessionToken}`, 'content-type': 'application/json' };
const token = await fetch(`${origin}/api/agent-tokens`, { method: 'POST', headers, body: JSON.stringify({ label: 'tutorial-oracle' }) }).then(async (r) => { if (!r.ok) throw new Error('Agent token unavailable.'); return r.json() as Promise<{ token: string }> });
const result = await runTutorialOracle(`${origin}/mcp`, token.token);
const report = await fetch(`${origin}/api/benchmarks`, { method: 'POST', headers, body: JSON.stringify({ label: 'tutorial-oracle', toolCalls: result.toolCalls }) }).then(async (r) => { if (!r.ok) throw new Error('Benchmark could not be stored.'); return r.json() as Promise<{ id: string; metrics: unknown }> });
await mkdir(resolve('docs/mcp'), { recursive: true });
await writeFile(resolve('docs/mcp/tutorial-benchmark.json'), JSON.stringify(report.metrics, null, 2) + '\n');
process.stdout.write(`Tutorial oracle completed ${result.toolCalls} real MCP calls; metrics saved to docs/mcp/tutorial-benchmark.json\n`);
