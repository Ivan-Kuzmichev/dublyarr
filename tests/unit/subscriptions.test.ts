import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { testDb } from './helpers';
import { fakeTmdb } from './fake-tmdb';
import { syncTitle } from '@/lib/catalog';
import { seedStudios } from '@/lib/studios';
import { builtinProfile } from '@/lib/profile';
import {
  subscribe,
  updateSubscription,
  unsubscribe,
  getSubscription,
  libraryItems,
  filterLibrary,
  libraryCounts,
  SubscriptionError,
} from '@/lib/subscriptions';
import type { TmdbTvDetails, TmdbSeason } from '@/lib/tmdb/types';

const fx = <T>(n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8')) as T;

async function setup() {
  const db = testDb();
  seedStudios(db);
  const running = { ...fx<TmdbTvDetails>('tv-1399'), id: 5, name: 'Бета', status: 'Returning Series' };
  const { tmdb } = fakeTmdb({
    details: { 1399: fx<TmdbTvDetails>('tv-1399'), 1429: fx<TmdbTvDetails>('tv-1429'), 5: running },
    seasons: {
      '1399:1': fx<TmdbSeason>('tv-1399-season-1'),
      '5:1': { season_number: 1, episodes: [{ episode_number: 1, name: 'x', air_date: '2026-10-05', runtime: 50 }] },
    },
  });
  const got = await syncTitle(db, tmdb, 1399, { now: 1 });
  const aot = await syncTitle(db, tmdb, 1429, { now: 1 });
  const beta = await syncTitle(db, tmdb, 5, { now: 1 });
  return { db, got, aot, beta };
}

test('подписка, правка, отписка', async () => {
  const { db, got } = await setup();
  const p = builtinProfile(db, 'series');
  const s = subscribe(db, got.id, p, 100);
  expect(s).toMatchObject({ titleId: got.id, subscribedAt: 100 });
  expect(() => subscribe(db, got.id, p)).toThrow(SubscriptionError);
  expect(() => subscribe(db, 9999, p)).toThrow('Сериал не найден');
  const upd = updateSubscription(db, got.id, { ...p, quality: { ...p.quality, target: 1080 } }, 200);
  expect(upd).toMatchObject({ subscribedAt: 100, updatedAt: 200 });
  expect(getSubscription(db, got.id)!.profile.quality.target).toBe(1080);
  expect(() => updateSubscription(db, 9999, p)).toThrow('Подписки нет');
  unsubscribe(db, got.id);
  expect(getSubscription(db, got.id)).toBeUndefined();
});

test('библиотека: ближайшая серия, сортировка, фильтры', async () => {
  const { db, got, aot, beta } = await setup();
  for (const t of [got, aot, beta]) subscribe(db, t.id, builtinProfile(db, t.kind));
  const items = libraryItems(db, '2026-09-30');
  expect(items.map((i) => i.title.nameRu)).toEqual(['Бета', 'Атака титанов', 'Игра престолов']);
  expect(items[0].next).toEqual({ season: 1, number: 1, airDate: '2026-10-05' });
  expect(items[1].next).toBeNull();
  expect(libraryCounts(items)).toEqual({ all: 3, airing: 1, ended: 2 });
  expect(filterLibrary(items, 'airing').map((i) => i.title.nameRu)).toEqual(['Бета']);
  expect(filterLibrary(items, 'ended')).toHaveLength(2);
});
