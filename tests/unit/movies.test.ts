import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { testDb } from './helpers';
import { fakeTmdb } from './fake-tmdb';
import { getTitleByTmdbId, syncTitle, titlesDueForRefresh } from '@/lib/catalog';
import { digitalReleased, MOVIE_EP, openMovie, syncMovie } from '@/lib/movies';
import { mapMovie, pickReleaseDates } from '@/lib/tmdb/map';
import { titles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { TmdbMovieDetails, TmdbSeason, TmdbTvDetails } from '@/lib/tmdb/types';

const fx = <T>(n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8')) as T;
const T0 = 1_800_000_000_000;
const matrix = () => fx<TmdbMovieDetails>('movie-603');

describe('TMDB: фильм', () => {
  test('даты релизов: RU в приоритете, потом US, потом любая страна; самые ранние каждого типа', () => {
    expect(pickReleaseDates(matrix().release_dates)).toEqual({ theatrical: '1999-10-14', digital: '2010-05-01', physical: '1999-09-21' });
    expect(pickReleaseDates({ results: [{ iso_3166_1: 'DE', release_dates: [{ type: 4, release_date: '2020-02-03T00:00:00.000Z' }] }] })).toEqual({ theatrical: null, digital: '2020-02-03', physical: null });
    expect(pickReleaseDates(undefined)).toEqual({ theatrical: null, digital: null, physical: null });
  });
  test('поля фильма', () => {
    const m = mapMovie(matrix());
    expect(m).toMatchObject({ tmdbId: 603, tmdbType: 'movie', kind: 'movie', nameRu: 'Матрица', nameOriginal: 'The Matrix', year: 1999, runtime: 136, status: 'released', altNames: ['Matrix'] });
    expect(mapMovie({ ...matrix(), status: 'Post Production', release_date: '' }).status).toBe('planned');
  });
});

describe('каталог фильмов', () => {
  const tmdb = () => fakeTmdb({ details: { 1399: fx<TmdbTvDetails>('tv-1399') }, seasons: { '1399:1': fx<TmdbSeason>('tv-1399-season-1') }, movies: { 603: matrix(), 1399: { ...matrix(), id: 1399, title: 'Фильм 1399' } } });
  test('сериал и фильм с одинаковым id в TMDB — разные записи', async () => {
    const db = testDb();
    const { tmdb: t } = tmdb();
    const s = await syncTitle(db, t, 1399, { now: T0 });
    const m = await syncMovie(db, t, 1399, T0);
    expect(s.id).not.toBe(m.id);
    expect(getTitleByTmdbId(db, 1399)?.nameRu).toBe('Игра престолов');
    expect(getTitleByTmdbId(db, 1399, 'movie')?.nameRu).toBe('Фильм 1399');
    await syncTitle(db, t, 1399, { now: T0 + 1 }); // повторная синхронизация сериала не трогает фильм
    expect(getTitleByTmdbId(db, 1399, 'movie')?.kind).toBe('movie');
  });
  test('openMovie: новый — из TMDB, свежий — из базы', async () => {
    const db = testDb();
    const { tmdb: t, calls } = tmdb();
    expect((await openMovie(db, t, 603, T0)).title.kind).toBe('movie');
    await openMovie(db, t, 603, T0 + 1000);
    expect(calls).toEqual(['movie:603']);
  });
  test('цифровой релиз: дата TMDB (цифровой/физический) или первая цифровая раздача', async () => {
    const db = testDb();
    const m = await syncMovie(db, tmdb().tmdb, 603, T0);
    expect(digitalReleased(m, '2000-01-01')).toBe('1999-09-21');
    expect(digitalReleased({ ...m, releaseDates: { theatrical: '2026-09-01', digital: '2026-10-20', physical: null } }, '2026-10-01')).toBeNull();
    expect(digitalReleased({ ...m, releaseDates: { theatrical: '2026-09-01', digital: '2026-10-20', physical: null }, digitalSeenAt: '2026-09-25' }, '2026-10-01')).toBe('2026-09-25');
    expect(digitalReleased({ ...m, releaseDates: null, digitalSeenAt: null }, '2026-10-01')).toBeNull();
    expect(MOVIE_EP).toEqual({ season: 0, number: 0 });
  });
  test('освежение: фильм без цифрового релиза — каждый день, вышедший — раз в месяц', async () => {
    const db = testDb();
    const m = await syncMovie(db, tmdb().tmdb, 603, T0);
    expect(titlesDueForRefresh(db, T0 + 86_400_000).map((t) => t.id)).not.toContain(m.id);
    db.update(titles).set({ releaseDates: { theatrical: '2099-01-01', digital: null, physical: null }, status: 'planned' }).where(eq(titles.id, m.id)).run();
    expect(titlesDueForRefresh(db, T0 + 86_400_000).map((t) => t.id)).toContain(m.id);
  });
});
