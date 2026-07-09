import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const nodePath = path.resolve(process.cwd(), 'node_modules');
const cliPath = require.resolve('@playwright/test/cli');

const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_PATH: process.env.NODE_PATH ? `${nodePath}${path.delimiter}${process.env.NODE_PATH}` : nodePath,
  },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
