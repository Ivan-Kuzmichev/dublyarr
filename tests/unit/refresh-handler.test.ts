import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { testDb } from './helpers';
import { fakeTmdb } from './fake-tmdb';
import { syncTitle, getTitleByTmdbId } from '@/lib/catalog';
import { refreshAll } from '@/worker/handlers';
import type { TmdbTvDetails } from '@/lib/tmdb/types';

const fx = <T>(n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8')) as T;

test('ошибка одного сериала не останавливает остальных', async () => {
  const db = testDb();
  const base = fx<TmdbTvDetails>('tv-1399');
  const a = { ...base, id: 1, status: 'Returning Series' };
  const b = { ...base, id: 2, status: 'Returning Series' };
  const { tmdb } = fakeTmdb({ details: { 1: a, 2: b }, seasons: {} });
  await syncTitle(db, tmdb, 1, { now: 1 });
  await syncTitle(db, tmdb, 2, { now: 1 });
  const flaky = fakeTmdb({ details: { 2: { ...b, name: 'Обновлён' } }, seasons: {} }); // id 1 → ошибка
  expect(await refreshAll(db, flaky.tmdb, 10)).toEqual({ ok: 1, failed: 1 });
  expect(getTitleByTmdbId(db, 2)?.nameRu).toBe('Обновлён');
  expect(await refreshAll(db, null, 10)).toEqual({ ok: 0, failed: 0 });
});
