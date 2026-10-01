import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { extendSeasons } from '@/lib/seasons-watch';
import { recentNotices } from '@/lib/notices';
import { subscribe, updateSubscription, wantedEpisodes } from '@/lib/subscriptions';
import { notices, seasons, subscriptions, titles } from '@/lib/db/schema';
import type { Profile } from '@/lib/profile-core';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const DAY = 86_400_000;
const profile = (autoNextSeason = true): Profile => ({
  dubs: [{ kind: 'any', waitDays: 0 }],
  quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: null },
  scope: { mode: 'all' },
  wholeSeasonAfterFinale: false,
  replaceWithHigher: true,
  autoNextSeason,
});

function setup(auto = true) {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 5, kind: 'series', nameRu: 'Дэдлок', nameOriginal: 'Deadloch', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  for (const n of [0, 1, 2]) db.insert(seasons).values({ titleId: t.id, number: n, name: `S${n}`, episodeCount: 8 }).run();
  subscribe(db, t.id, profile(auto), 1);
  const addSeason = (n: number) => db.insert(seasons).values({ titleId: t.id, number: n, name: `S${n}`, episodeCount: 8 }).run();
  return { db, t, addSeason };
}

test('подписка запоминает последний сезон; серии за границей не нужны', () => {
  const { db } = setup();
  const sub = db.select().from(subscriptions).get()!;
  expect(sub.maxSeason).toBe(2);
  const eps = [1, 2, 3].map((season) => ({ season, number: 1, airDate: '2026-01-01' }));
  expect(wantedEpisodes(sub, eps, '2026-09-30').map((e) => e.season)).toEqual([1, 2]);
  expect(wantedEpisodes({ ...sub, maxSeason: null }, eps, '2026-09-30').map((e) => e.season)).toEqual([1, 2, 3]);
});

test('новый сезон и флаг — подписка расширяется, одна заметка', () => {
  const { db, t, addSeason } = setup();
  expect(extendSeasons(db, t.id, 10)).toBe('none');
  addSeason(3);
  expect(extendSeasons(db, t.id, 10)).toBe('extended');
  expect(db.select().from(subscriptions).get()!.maxSeason).toBe(3);
  expect(extendSeasons(db, t.id, 11)).toBe('none');
  expect(db.select().from(notices).all()).toEqual([expect.objectContaining({ kind: 'season-subscribed', text: 'Подписался на 3-й сезон' })]);
});

test('без флага — только заметка, граница прежняя; без подписки — ничего', () => {
  const { db, t, addSeason } = setup(false);
  addSeason(3);
  expect(extendSeasons(db, t.id, 10)).toBe('noted');
  expect(extendSeasons(db, t.id, 11)).toBe('none');
  expect(db.select().from(subscriptions).get()!.maxSeason).toBe(2);
  expect(db.select().from(notices).all().map((n) => n.text)).toEqual(['Вышел 3-й сезон — подписка его не включает']);
  db.delete(subscriptions).run();
  addSeason(4);
  expect(extendSeasons(db, t.id, 12)).toBe('none');
});

test('заметки за 3 дня', () => {
  const { db, t } = setup();
  db.insert(notices).values({ titleId: t.id, kind: 'season-subscribed', text: 'старая', createdAt: 0 }).run();
  db.insert(notices).values({ titleId: t.id, kind: 'season-subscribed', text: 'свежая', createdAt: 5 * DAY }).run();
  expect(recentNotices(db, 6 * DAY)).toEqual([{ tmdbId: 5, title: 'Дэдлок', text: 'свежая', createdAt: 5 * DAY }]);
});

test('синхронизация из TMDB сама расширяет подписку', async () => {
  const { readFileSync } = await import('node:fs');
  const { fakeTmdb } = await import('./fake-tmdb');
  const { syncTitle } = await import('@/lib/catalog');
  const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8'));
  const db = testDb();
  const details = fx('tv-1399');
  const { tmdb } = fakeTmdb({ details: { 1399: details }, seasons: { '1399:1': fx('tv-1399-season-1') } });
  const t = await syncTitle(db, tmdb, 1399, { now: 1 });
  subscribe(db, t.id, profile(), 1);
  const before = db.select().from(subscriptions).get()!.maxSeason!;
  details.seasons.push({ ...details.seasons.at(-1), id: 999, season_number: before + 1, name: 'Новый' });
  await syncTitle(db, tmdb, 1399, { now: 2 });
  expect(db.select().from(subscriptions).get()!.maxSeason).toBe(before + 1);
});

test('правка подписки включает все известные сезоны', () => {
  const { db, t, addSeason } = setup(false);
  addSeason(3);
  updateSubscription(db, t.id, profile(false), 5);
  expect(db.select().from(subscriptions).get()!.maxSeason).toBe(3);
});
