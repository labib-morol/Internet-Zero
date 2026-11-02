import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const [command, ...args] = process.argv.slice(2);
const target = command === 'agent-token' ? 'apps/server/src/agent-token-cli.ts' : 'packages/compiler/src/cli.ts';
const forwarded = command === 'agent-token' ? args : [command, ...args].filter((arg): arg is string => arg !== undefined);
const child = spawn(process.execPath, ['--import', 'tsx', resolve(target), ...forwarded], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
