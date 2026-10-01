import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { testDb } from './helpers';
import { fakeTmdb } from './fake-tmdb';
import {
  syncTitle,
  openTitle,
  setKind,
  listEpisodes,
  listSeasons,
  titlesDueForRefresh,
  upcomingTitles,
  STALE_MS,
  getTitleByTmdbId,
} from '@/lib/catalog';
import { TmdbError, type Tmdb } from '@/lib/tmdb/client';
import type { TmdbSeason, TmdbTvDetails } from '@/lib/tmdb/types';

const fx = <T>(n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8')) as T;
const got = () =>
  fakeTmdb({
    details: { 1399: fx<TmdbTvDetails>('tv-1399') },
    seasons: { '1399:1': fx<TmdbSeason>('tv-1399-season-1'), '1399:0': fx<TmdbSeason>('tv-1399-season-0') },
  });
const T0 = 1_800_000_000_000;

test('первая синхронизация: сериал, все сезоны, серии', async () => {
  const db = testDb();
  const { tmdb, calls } = got();
  const t = await syncTitle(db, tmdb, 1399, { now: T0 });
  expect(t.refreshedAt).toBe(T0);
  expect(calls).toEqual(['details:1399', 'season:1399:0', 'season:1399:1']);
  expect(listSeasons(db, t.id).map((s) => s.number)).toEqual([0, 1]);
  expect(listEpisodes(db, t.id, 1).map((e) => e.name)).toEqual(['Зима близко', 'Королевский тракт', 'Лорд Сноу']);
});

test('повторная синхронизация: только изменившиеся и последний сезон; удалённые серии исчезают', async () => {
  const db = testDb();
  const data = { details: { 1399: fx<TmdbTvDetails>('tv-1399') }, seasons: { '1399:1': fx<TmdbSeason>('tv-1399-season-1') } };
  await syncTitle(db, fakeTmdb(data).tmdb, 1399, { now: T0 });
  data.seasons['1399:1'].episodes = data.seasons['1399:1'].episodes.slice(0, 2);
  const again = fakeTmdb(data);
  const t = await syncTitle(db, again.tmdb, 1399, { now: T0 + 1 });
  expect(again.calls).toEqual(['details:1399', 'season:1399:1']);
  expect(listEpisodes(db, t.id, 1)).toHaveLength(2);
});

test('сезон пропал из TMDB — удаляется вместе с сериями', async () => {
  const db = testDb();
  const d = fx<TmdbTvDetails>('tv-1399');
  const data = { details: { 1399: d }, seasons: { '1399:0': fx<TmdbSeason>('tv-1399-season-0') } };
  const t = await syncTitle(db, fakeTmdb(data).tmdb, 1399, { now: T0 });
  d.seasons = d.seasons.filter((s) => s.season_number !== 0);
  await syncTitle(db, fakeTmdb(data).tmdb, 1399, { now: T0 + 1 });
  expect(listSeasons(db, t.id).map((s) => s.number)).toEqual([1]);
  expect(listEpisodes(db, t.id, 0)).toEqual([]);
});

test('ручной тип переживает обновление', async () => {
  const db = testDb();
  const { tmdb } = got();
  const t = await syncTitle(db, tmdb, 1399, { now: T0 });
  setKind(db, t.id, 'anime');
  const after = await syncTitle(db, tmdb, 1399, { now: T0 + 1 });
  expect(after).toMatchObject({ kind: 'anime', kindManual: true });
});

test('openTitle: свежий — без запросов; устаревший при недоступном TMDB — из базы с пометкой', async () => {
  const db = testDb();
  const { tmdb, calls } = got();
  await openTitle(db, tmdb, 1399, T0);
  const n = calls.length;
  expect((await openTitle(db, tmdb, 1399, T0 + 1000)).stale).toBe(false);
  expect(calls.length).toBe(n);
  const broken: Tmdb = {
    ...tmdb,
    details: async () => {
      throw new TmdbError('TMDB не отвечает: timeout', 'network');
    },
  };
  const r = await openTitle(db, broken, 1399, T0 + STALE_MS + 1);
  expect(r).toMatchObject({ stale: true, error: 'TMDB не отвечает: timeout' });
  expect(r.title.nameRu).toBe('Игра престолов');
  await expect(openTitle(db, broken, 1429, T0)).rejects.toBeInstanceOf(TmdbError);
  await expect(openTitle(db, null, 1429, T0)).rejects.toThrow('Добавьте ключ TMDB');
});

test('кого обновлять и что скоро выходит', async () => {
  const db = testDb();
  const d = fx<TmdbTvDetails>('tv-1399');
  const running = { ...d, id: 7, status: 'Returning Series', next_episode_to_air: { air_date: '2026-10-20' } };
  const { tmdb } = fakeTmdb({ details: { 1399: d, 7: running }, seasons: {} });
  await syncTitle(db, tmdb, 1399, { now: T0 });
  await syncTitle(db, tmdb, 7, { now: T0 });
  expect(titlesDueForRefresh(db, T0 + 1).map((t) => t.tmdbId)).toEqual([7]);
  expect(
    titlesDueForRefresh(db, T0 + 31 * 86_400_000)
      .map((t) => t.tmdbId)
      .sort(),
  ).toEqual([1399, 7]);
  expect(upcomingTitles(db, '2026-09-30').map((t) => t.tmdbId)).toEqual([7]);
  expect(upcomingTitles(db, '2026-09-30', 10)).toEqual([]);
  expect(getTitleByTmdbId(db, 7)?.status).toBe('returning');
});

test('смена типа во время обновления не теряется', async () => {
  const db = testDb();
  const { tmdb } = got();
  const t = await syncTitle(db, tmdb, 1399, { now: T0 });
  const racing: Tmdb = {
    ...tmdb,
    season: async (id, n) => {
      const s = await tmdb.season(id, n);
      setKind(db, t.id, 'anime'); // пользователь переключил тип, пока грузились сезоны
      return s;
    },
  };
  const after = await syncTitle(db, racing, 1399, { now: T0 + 1 });
  expect(after).toMatchObject({ kind: 'anime', kindManual: true });
});

test('два одновременных открытия нового сериала не падают', async () => {
  const db = testDb();
  const { tmdb } = got();
  const [a, b] = await Promise.all([syncTitle(db, tmdb, 1399, { now: T0 }), syncTitle(db, tmdb, 1399, { now: T0 })]);
  expect(a.id).toBe(b.id);
  expect(listSeasons(db, a.id)).toHaveLength(2);
});

test('после неудачного обновления карточка 10 минут не ждёт TMDB', async () => {
  const db = testDb();
  const { tmdb } = got();
  await syncTitle(db, tmdb, 1399, { now: T0 });
  let calls = 0;
  const hanging: Tmdb = {
    ...tmdb,
    details: async () => {
      calls++;
      throw new TmdbError('TMDB не отвечает: timeout', 'network');
    },
  };
  const t1 = T0 + STALE_MS + 1;
  expect((await openTitle(db, hanging, 1399, t1)).stale).toBe(true);
  expect((await openTitle(db, hanging, 1399, t1 + 5 * 60_000)).stale).toBe(true);
  expect(calls).toBe(1);
  await openTitle(db, hanging, 1399, t1 + 11 * 60_000);
  expect(calls).toBe(2);
});

test('кадр серии из TMDB сохраняется', async () => {
  const db = testDb();
  const s1 = fx<TmdbSeason>('tv-1399-season-1');
  s1.episodes[0].still_path = '/still1.jpg';
  const { tmdb } = fakeTmdb({ details: { 1399: fx<TmdbTvDetails>('tv-1399') }, seasons: { '1399:1': s1, '1399:0': fx<TmdbSeason>('tv-1399-season-0') } });
  const t = await syncTitle(db, tmdb, 1399, { now: T0 });
  expect(listEpisodes(db, t.id, 1)[0].stillPath).toBe('/still1.jpg');
});
