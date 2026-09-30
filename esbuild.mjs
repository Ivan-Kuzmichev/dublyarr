import { build } from 'esbuild';
import path from 'node:path';

// Воркер, супервизор и CLI — отдельные бандлы; нативные модули остаются в node_modules.
const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['better-sqlite3', '@node-rs/argon2', 'pino'],
  alias: { '@': path.resolve('src') },
  logLevel: 'info',
};

await Promise.all([
  build({ ...common, entryPoints: ['src/worker/main.ts'], outfile: 'dist/worker.cjs' }),
  build({ ...common, entryPoints: ['src/entry/main.ts'], outfile: 'dist/supervisor.cjs' }),
  build({ ...common, entryPoints: ['src/cli/main.ts'], outfile: 'dist/cli.cjs' }),
]);
