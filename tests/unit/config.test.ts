import { expect, test } from 'vitest';
import { loadConfig } from '@/lib/config';

test('значения по умолчанию', () => {
  const c = loadConfig({});
  expect(c.dataDir).toBe('/data');
  expect(c.dbPath).toBe('/data/db.sqlite');
  expect(c.port).toBe(3000);
  expect(c.layaPort).toBe(8765);
});

test('DATA_DIR и порты из env', () => {
  const c = loadConfig({ DATA_DIR: '/tmp/x', PORT: '8080', LAYA_PORT: '9000', DUBLYARR_SECRET_KEY: 'k' });
  expect(c.dbPath).toBe('/tmp/x/db.sqlite');
  expect(c.port).toBe(8080);
  expect(c.layaPort).toBe(9000);
  expect(c.secretKeyEnv).toBe('k');
});
