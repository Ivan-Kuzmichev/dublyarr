import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDbWithChat } from './helpers';
import { libraryItems, filterLibrary, libraryCounts } from '@/lib/subscriptions';
import { todayData, calendarWeek } from '@/lib/dashboard';
import { activityQueue } from '@/lib/activity';
import { loadDiscover } from '@/lib/discover';
import { codeRange, notifyImported } from '@/lib/notify-events';
import { parsePathsForm } from '@/lib/paths-form';
import { titleHref } from '@/lib/title-href';
import { DEFAULT_MOVIE_PROFILE } from '@/lib/movie-profile';
import { downloads, episodeFiles, notifications, subscriptions, titles, wantedState } from '@/lib/db/schema';
import type { Tmdb } from '@/lib/tmdb/client';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const TODAY = '2026-10-01';

function setup() {
  const db = testDbWithChat();
  const m = db.insert(titles).values({ tmdbId: 603, tmdbType: 'movie', kind: 'movie', nameRu: 'Матрица', nameOriginal: 'The Matrix', originalLanguage: 'en', year: 1999, status: 'released', runtime: 136, releaseDates: { theatrical: '2026-08-01', digital: '2026-09-30', physical: null }, createdAt: 1, refreshedAt: 1 }).returning().get();
  db.insert(subscriptions).values({ titleId: m.id, profile: DEFAULT_MOVIE_PROFILE, subscribedAt: 1, updatedAt: 1 }).run();
  const s = db.insert(titles).values({ tmdbId: 603, kind: 'series', nameRu: 'Сериал', nameOriginal: 'S', originalLanguage: 'en', status: 'ended', createdAt: 1, refreshedAt: 1 }).returning().get();
  db.insert(subscriptions).values({ titleId: s.id, profile: { dubs: [], quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: null }, scope: { mode: 'all' }, wholeSeasonAfterFinale: false, replaceWithHigher: false, autoNextSeason: false }, subscribedAt: 1, updatedAt: 1 }).run();
  return { db, m, s };
}

test('ссылки на карточку', () => {
  expect(titleHref({ kind: 'movie', tmdbId: 603 })).toBe('/movie/603');
  expect(titleHref({ kind: 'anime', tmdbId: 1 })).toBe('/series/1');
  expect(codeRange([{ season: 0, number: 0 }])).toBe('фильм');
});

describe('библиотека', () => {
  test('фильмы — своим фильтром; «В эфире» и «Завершены» — только сериалы; статус фильма', () => {
    const { db, m } = setup();
    db.insert(wantedState).values({ titleId: m.id, season: 0, number: 0, state: 'waiting', reason: 'Ждём дубляж до 14 окт', until: '2026-10-14', checkedAt: 1 }).run();
    const items = libraryItems(db, TODAY);
    expect(filterLibrary(items, 'movies').map((i) => [i.title.nameRu, i.status])).toEqual([['Матрица', 'Ждём дубляж до 14 окт']]);
    expect(filterLibrary(items, 'ended').map((i) => i.title.nameRu)).toEqual(['Сериал']);
    expect(libraryCounts(items)).toEqual({ all: 2, airing: 0, ended: 1 });
  });
});

describe('«Сегодня», календарь, активность, уведомления', () => {
  test('ждём дубляж: фильм с датой', () => {
    const { db, m } = setup();
    db.insert(wantedState).values({ titleId: m.id, season: 0, number: 0, state: 'waiting', reason: 'Ждём дубляж до 14 окт', until: '2026-10-14', checkedAt: 1 }).run();
    expect(todayData(db, TODAY).waiting).toEqual([expect.objectContaining({ tmdbId: 603, movie: true, code: 'фильм', aired: '30 сент', etaText: 'Дубляж ≈ 14 окт' })]);
  });
  test('календарь: цифровой релиз и прогноз дубляжа', () => {
    const { db, m } = setup();
    db.insert(wantedState).values({ titleId: m.id, season: 0, number: 0, state: 'waiting', reason: 'r', until: '2026-10-02', checkedAt: 1 }).run();
    const ev = calendarWeek(db, '2026-09-28', TODAY).days.flatMap((d) => d.events);
    expect(ev).toEqual([
      expect.objectContaining({ date: '2026-09-30', title: 'Матрица', movie: true, code: 'фильм', kind: 'aired', sub: 'цифровой релиз' }),
      expect.objectContaining({ date: '2026-10-02', title: 'Матрица', movie: true, kind: 'forecast', sub: 'дубляж' }),
    ]);
  });
  test('активность и Telegram: «фильм» вместо S00E00, ссылка на карточку фильма', () => {
    const { db, m } = setup();
    const d = db.insert(downloads).values({ hash: 'a'.repeat(40), titleId: m.id, season: 0, kind: 'movie', episodes: [{ season: 0, number: 0 }], state: 'downloading', progress: 0.3, name: 'x', size: 1, addedAt: 1, studioLabel: 'Дубляж', resolution: 1080 }).returning().get();
    expect(activityQueue(db, 1)[0]).toMatchObject({ code: 'фильм', movie: true });
    db.insert(episodeFiles).values({ titleId: m.id, season: 0, number: 0, path: 'x.mkv', size: 1, method: 'hardlink', importedAt: Date.now(), resolution: 1080, studioLabel: 'Дубляж' }).run();
    expect(todayData(db, TODAY).fresh.find((f) => !f.loading)).toMatchObject({ code: 'фильм', movie: true });
    notifyImported(db, d, [{ season: 0, number: 0 }]);
    expect(db.select().from(notifications).get()!.text).toBe('📥 Матрица — Дубляж 1080p');
  });
});

describe('поиск и тренды', () => {
  const tmdb = (o: Partial<Tmdb> = {}): Tmdb => ({
    configuration: async () => {},
    details: async () => { throw new Error(); },
    season: async () => { throw new Error(); },
    movie: async () => { throw new Error(); },
    search: async () => [{ id: 1, name: 'Матрица: Воскрешение (сериал)', original_name: 'x', poster_path: null, genre_ids: [], origin_country: ['US'] }],
    trending: async () => [],
    searchMulti: async () => [
      { id: 603, media_type: 'movie', title: 'Матрица', release_date: '1999-03-30', poster_path: '/m.jpg' },
      { id: 1, media_type: 'tv', name: 'дубль сериала', poster_path: null },
    ],
    trendingAll: async () => [{ id: 1001, media_type: 'movie', title: 'Миссия: Красный', release_date: '2024-11-06', poster_path: null }],
    ...o,
  });
  test('поиск — сериалы и фильмы; главная — популярные фильмы', async () => {
    const db = testDbWithChat();
    const s = await loadDiscover(db, tmdb(), 'матрица', TODAY);
    expect(s.mode === 'search' && s.cards.map((c) => [c.tmdbId, c.movie ?? false])).toEqual([
      [1, false],
      [603, true],
    ]);
    const home = await loadDiscover(db, tmdb(), undefined, TODAY);
    expect(home.mode === 'home' && home.movies.map((c) => [c.name, c.year, c.movie])).toEqual([['Миссия: Красный', 2024, true]]);
  });
  test('ошибка поиска фильмов не мешает сериалам', async () => {
    const s = await loadDiscover(testDbWithChat(), tmdb({ searchMulti: async () => { throw new Error('x'); } }), 'матрица', TODAY);
    expect(s).toMatchObject({ mode: 'search', cards: [expect.objectContaining({ tmdbId: 1 })] });
  });
});

test('папки: папка фильмов — абсолютный путь, шаблон по умолчанию', () => {
  const f = (o: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ downloads: '/d', media: '/m', ...o })) fd.set(k, v);
    return parsePathsForm(fd);
  };
  expect(f({ movies: '/movies/' })).toMatchObject({ movies: '/movies', movieTemplate: '{Название} ({Год})/{Название} ({Год}) [{Перевод} {Качество}]' });
  expect(f({ movies: 'movies' })).toEqual({ error: 'Папка фильмов: нужен абсолютный путь' });
  expect(f({})).not.toHaveProperty('movies');
});
