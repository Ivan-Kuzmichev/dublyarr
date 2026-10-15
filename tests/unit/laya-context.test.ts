import { expect, test } from 'vitest';
import { parsedLine, seasonsLine, titleLine } from '@/lib/laya/context';
import type { ParsedRelease } from '@/lib/parse/types';

const parsed = (p: Partial<ParsedRelease>) => ({ seasons: [], episodes: null, totalInSeason: null, absolute: false, pack: false, year: null, ...p }) as ParsedRelease;

test('сериал: названия, тип и годы выхода', () => {
  expect(titleLine({ nameRu: 'Офис', nameOriginal: 'The Office', year: 2005, lastAirDate: '2013-05-16', kind: 'series' })).toBe('Офис (The Office), сериал, 2005–2013');
  expect(titleLine({ nameRu: 'Фарго', nameOriginal: 'Fargo', year: 1996, lastAirDate: null, kind: 'movie' })).toBe('Фарго (Fargo), фильм, 1996');
  expect(titleLine({ nameRu: 'Тед Лассо', nameOriginal: 'Ted Lasso', year: 2020, lastAirDate: '2020-10-02', kind: 'series' })).toBe('Тед Лассо (Ted Lasso), сериал, 2020');
});

test('сезоны: число и серий в каждом; спецвыпуски не считаются', () => {
  expect(seasonsLine([{ number: 0, episodeCount: 9 }, { number: 1, episodeCount: 6 }, { number: 2, episodeCount: 22 }])).toBe('2 (серий: 6, 22)');
  expect(seasonsLine([])).toBeNull();
});

test('что разобрал парсер: сезоны, серии, сквозная нумерация, год', () => {
  expect(parsedLine(parsed({ seasons: [2], episodes: { from: 1, to: 9 }, totalInSeason: 9, pack: true, year: 2016 }))).toBe('сезон 2, серии 1–9 из 9, год 2016');
  expect(parsedLine(parsed({ seasons: [4], episodes: { from: 5, to: 5 } }))).toBe('сезон 4, серия 5');
  expect(parsedLine(parsed({ absolute: true, episodes: { from: 1, to: 170 } }))).toBe('серии 1–170 (сквозная нумерация)');
  expect(parsedLine(parsed({ seasons: [1, 2, 3], pack: true }))).toBe('сезоны 1–3');
  expect(parsedLine(parsed({}))).toBe('сезон и серии не указаны');
});
