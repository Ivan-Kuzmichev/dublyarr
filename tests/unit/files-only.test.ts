import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { subscribe, wantedEpisodes, setFilesOnly, getSubscription } from '@/lib/subscriptions';
import { extendSeasons } from '@/lib/seasons-watch';
import { getDefaultProfile } from '@/lib/profile';
import { seasons, subscriptions, titles } from '@/lib/db/schema';

const eps = [{ season: 1, number: 1, airDate: '2026-01-01' }, { season: 1, number: 2, airDate: '2026-01-08' }];

test('«только файлы»: нужных серий нет — автопоиск, паки, «Ждём» и календарь её не трогают; новые сезоны не подписываются', () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 5, kind: 'series', nameRu: 'Силос', nameOriginal: 'Silo', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = subscribe(db, t.id, { ...getDefaultProfile(db, 'series'), autoNextSeason: true }, 1);
  expect(wantedEpisodes(s, eps, '2026-10-16').length).toBe(2);
  setFilesOnly(db, t.id, true);
  const off = getSubscription(db, t.id)!;
  expect(off.filesOnly).toBe(true);
  expect(wantedEpisodes(off, eps, '2026-10-16')).toEqual([]);
  db.insert(seasons).values([{ titleId: t.id, number: 1, name: 'S1', episodeCount: 2 }, { titleId: t.id, number: 2, name: 'S2', episodeCount: 8 }]).run();
  db.update(subscriptions).set({ maxSeason: 1 }).run();
  expect(extendSeasons(db, t.id, 2)).toBe('none');
  setFilesOnly(db, t.id, false);
  expect(wantedEpisodes(getSubscription(db, t.id)!, eps, '2026-10-16').length).toBe(2);
});

test('«Библиотека»: у подписки «только файлы» — пометка', async () => {
  const { libraryItems } = await import('@/lib/subscriptions');
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 6, kind: 'series', nameRu: 'Бифф', nameOriginal: 'BEEF', originalLanguage: 'en', status: 'ended', createdAt: 1, refreshedAt: 1 }).returning().get();
  subscribe(db, t.id, getDefaultProfile(db, 'series'), 1);
  expect(libraryItems(db, '2026-10-16')[0].filesOnly).toBe(false);
  setFilesOnly(db, t.id, true);
  expect(libraryItems(db, '2026-10-16')[0].filesOnly).toBe(true);
});

test('статусы серий у «только файлов»: вышедшая без файла — «Нет файла», а не «Не по подписке»', async () => {
  const { episodeStatuses } = await import('@/lib/dashboard');
  const { episodes } = await import('@/lib/db/schema');
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 7, kind: 'series', nameRu: 'Грызня', nameOriginal: 'BEEF', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  db.insert(episodes).values({ titleId: t.id, season: 2, number: 1, name: 'E1', airDate: '2026-04-16' }).run();
  subscribe(db, t.id, getDefaultProfile(db, 'series'), Date.parse('2026-10-01'));
  setFilesOnly(db, t.id, true);
  expect(episodeStatuses(db, t.id, '2026-10-16').get('2:1')).toMatchObject({ state: 'skipped', text: 'Нет файла' });
});
