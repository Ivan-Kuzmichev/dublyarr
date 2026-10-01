import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// Каждый прогон — свежая база: сценарий начинается с первого запуска.
const dir = process.env.E2E_DIR ?? mkdtempSync(path.join(tmpdir(), 'dy-e2e-'));
process.env.E2E_DIR = dir;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100' },
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 900 } } }],
  fullyParallel: false,
  webServer: [
    { command: 'node tests/e2e/tmdb-stub.mjs 3199', url: 'http://127.0.0.1:3199/3/configuration?api_key=ok' },
    { command: 'node tests/e2e/jackett-stub.mjs 3198', url: 'http://127.0.0.1:3198/api?t=caps&apikey=ok' },
    {
      command: 'node tests/e2e/qbit-stub.mjs 3197',
      url: 'http://127.0.0.1:3197/api/v2/auth/login',
      env: { QBIT_DIR: path.join(dir, 'qbit'), QBIT_STEP: '1' },
    },
    { command: 'node tests/e2e/telegram-stub.mjs 3196', url: 'http://127.0.0.1:3196/__sent' },
    {
      command: 'pnpm build && node dist/supervisor.cjs',
      url: 'http://127.0.0.1:3100/api/health',
      timeout: 240_000,
      env: {
        DATA_DIR: path.join(dir, 'data'),
        PORT: '3100',
        LAYA_PORT: '18765',
        DUBLYARR_SECRET_KEY: randomBytes(32).toString('base64'),
        TMDB_BASE_URL: 'http://127.0.0.1:3199/3',
        TMDB_IMAGE_BASE_URL: 'http://127.0.0.1:3199/t/p',
        TELEGRAM_API_BASE: 'http://127.0.0.1:3196',
      },
    },
  ],
});
