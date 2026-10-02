import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { isAnime, mapDetails, mapEpisodes, mapSeasons, mapStatus } from '@/lib/tmdb/map';
import type { TmdbSeason, TmdbTvDetails } from '@/lib/tmdb/types';

const fx = <T>(n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8')) as T;

test('аниме: Анимация + Япония', () => {
  expect(isAnime([16], ['JP'])).toBe(true);
  expect(isAnime([16], ['US'])).toBe(false);
  expect(isAnime([18], ['JP'])).toBe(false);
});

test('статусы TMDB', () => {
  expect(['Returning Series', 'Ended', 'Canceled', 'In Production', 'Planned', 'Pilot', 'странное'].map(mapStatus)).toEqual([
    'returning',
    'ended',
    'canceled',
    'in_production',
    'planned',
    'planned',
    'returning',
  ]);
});

test('Игра престолов: поля и альтернативные названия', () => {
  const t = mapDetails(fx<TmdbTvDetails>('tv-1399'));
  expect(t).toMatchObject({
    tmdbId: 1399,
    kind: 'series',
    nameRu: 'Игра престолов',
    nameOriginal: 'Game of Thrones',
    year: 2011,
    status: 'ended',
    nextAirDate: null,
  });
  expect(t.altNames).toEqual(['Игра тронов', 'GoT']);
  expect(t.genres).toEqual(['Sci-Fi & Fantasy', 'Драма']);
  expect(t.networks).toEqual(['HBO']);
});

test('Атака титанов: аниме, романдзи, без дубля русского названия', () => {
  const t = mapDetails(fx<TmdbTvDetails>('tv-1429'));
  expect(t.kind).toBe('anime');
  expect(t.altNames).toEqual(['Shingeki no Kyojin', 'Attack on Titan']);
});

test('сезоны и серии; пустая дата эфира → null', () => {
  expect(mapSeasons(fx<TmdbTvDetails>('tv-1399')).map((s) => s.number)).toEqual([0, 1]);
  const eps = mapEpisodes(fx<TmdbSeason>('tv-1399-season-1'));
  expect(eps[0]).toEqual({ season: 1, number: 1, name: 'Зима близко', airDate: '2011-04-17', runtime: 62, stillPath: null });
  expect(eps[2].airDate).toBeNull();
});

test('английское название (translations) и латиница из страны происхождения — в альтернативные названия', () => {
  const d = fx<TmdbTvDetails>('tv-1399');
  Object.assign(d, {
    name: 'Великий расхититель гробниц',
    original_name: '도굴왕',
    origin_country: ['KR'],
    alternative_titles: {
      results: [
        { iso_3166_1: 'JP', title: 'Toukutsu Ou', type: '' },
        { iso_3166_1: 'KR', title: 'Dogulwang', type: '' },
        { iso_3166_1: 'KR', title: '도굴 왕', type: '' }, // не латиница — трекеры не найдут
        { iso_3166_1: 'DE', title: 'Grabräuberkönig', type: '' }, // чужая страна — не нужна
      ],
    },
    translations: { translations: [{ iso_639_1: 'en', data: { name: 'Tomb Raider King' } }, { iso_639_1: 'de', data: { name: 'X' } }] },
  });
  expect(mapDetails(d).altNames).toEqual(['Tomb Raider King', 'Toukutsu Ou', 'Dogulwang']);
});
