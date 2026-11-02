import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const children = [
  spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], { stdio: 'inherit', env: { ...process.env, WORLDS_DIR: resolve('dist/worlds') } }),
  spawn(process.execPath, [resolve('apps/web/node_modules/vite/bin/vite.js'), '--port', '5173'], { cwd: resolve('apps/web'), stdio: 'inherit' }),
];
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { for (const child of children) child.kill(signal); });
for (const child of children) child.on('exit', (code) => { if (code) { for (const sibling of children) sibling.kill(); process.exitCode = code; } });
