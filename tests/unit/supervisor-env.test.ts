import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { layaChild } from '@/entry/laya-child';
import { saveTmdbSettings } from '@/lib/tmdb';
import { loadConfig } from '@/lib/config';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('Laya: python из venv образа (иначе системный), папка модели, порт, прокси TMDB', () => {
  const db = testDb();
  const cfg = loadConfig({ DATA_DIR: '/data', LAYA_PORT: '8765' });
  expect(layaChild(cfg, db, () => false)).toEqual({ name: 'laya', command: 'python3', args: ['laya/serve.py', '--port', '8765'], env: { LAYA_DIR: '/data/laya', HF_HUB_DISABLE_PROGRESS_BARS: '1', TQDM_DISABLE: '1' } });
  saveTmdbSettings(db, { apiKey: 'k', proxy: 'http://proxy:3128' });
  const c = layaChild(cfg, db, (p) => p === '/opt/laya/bin/python');
  expect(c.command).toBe('/opt/laya/bin/python');
  expect(c.env).toEqual({ LAYA_DIR: '/data/laya', HF_HUB_DISABLE_PROGRESS_BARS: '1', TQDM_DISABLE: '1', HTTPS_PROXY: 'http://proxy:3128', HTTP_PROXY: 'http://proxy:3128' });
});
