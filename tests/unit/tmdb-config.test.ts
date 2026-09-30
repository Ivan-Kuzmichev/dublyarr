import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { getTmdb, getTmdbSettings, saveTmdbSettings } from '@/lib/tmdb';
import { appSettings } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('ключ TMDB хранится зашифрованным; без ключа клиента нет', () => {
  const db = testDb();
  expect(getTmdb(db)).toBeNull();
  saveTmdbSettings(db, { apiKey: 'SECRET-TMDB-KEY', proxy: '' });
  expect(getTmdbSettings(db)).toEqual({ apiKey: 'SECRET-TMDB-KEY' });
  expect(db.select().from(appSettings).get()!.value).not.toContain('SECRET');
  expect(getTmdb(db)).not.toBeNull();
});

test('проверка ключа TMDB: сеть недоступна — понятная ошибка', async () => {
  const { checkTmdb } = await import('@/lib/tmdb');
  process.env.TMDB_BASE_URL = 'http://127.0.0.1:9/3'; // закрытый порт
  const r = await checkTmdb({ apiKey: 'k' });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/^TMDB не отвечает/);
  delete process.env.TMDB_BASE_URL;
});
