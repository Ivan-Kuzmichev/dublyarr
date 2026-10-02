import { expect, test } from 'vitest';
import { absoluteToSeason, coursOf, dice, matchRelease, resolveAbsolute, resolveCours, type TitleInfo } from '@/lib/match';
import { parseEpisodes, parseNames, normalizeTitle } from '@/lib/parse/index';
import type { ParsedRelease } from '@/lib/parse/types';

const GB = 1024 ** 3;
const parsed = (title: string, resolution: ParsedRelease['resolution'] = 1080): ParsedRelease => {
  const { names, year } = parseNames(title);
  return {
    base: normalizeTitle(names[0] ?? title), names, year, ...parseEpisodes(title),
    resolution, source: 'webdl', hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false,
  };
};
const got: TitleInfo = { names: ['Игра престолов', 'Game of Thrones', 'Игра тронов'], year: 2011, kind: 'series', seasons: [{ number: 1, episodeCount: 10, year: 2011 }] };

test('сквозная нумерация', () => {
  const s = [{ season: 1, count: 25 }, { season: 2, count: 12 }];
  expect(absoluteToSeason(37, s)).toEqual({ season: 2, episode: 12 });
  expect(absoluteToSeason(26, s)).toEqual({ season: 2, episode: 1 });
  expect(absoluteToSeason(25, s)).toEqual({ season: 1, episode: 25 });
  expect(absoluteToSeason(40, s)).toBeNull();
  expect(absoluteToSeason(0, s)).toBeNull();
});

test('resolveAbsolute: E26-E37 при сезонах 25+12 → S2E1-12', () => {
  const t: TitleInfo = { names: ['Shingeki no Kyojin'], year: 2013, kind: 'anime', seasons: [{ number: 1, episodeCount: 25, year: 2013 }, { number: 2, episodeCount: 12, year: 2017 }] };
  expect(resolveAbsolute(parsed('Атака титанов / E26-E37 Shingeki no Kyojin'), t)).toMatchObject({ seasons: [2], episodes: { from: 1, to: 12 }, absolute: false });
  expect(resolveAbsolute(parsed('Атака титанов / E01-E25 Shingeki no Kyojin'), t)).toMatchObject({ seasons: [1], episodes: { from: 1, to: 25 }, absolute: false });
  expect(resolveAbsolute(parsed('Атака титанов / E20-E30 Shingeki no Kyojin'), t)).toMatchObject({ seasons: [1, 2], episodes: null, pack: true });
});

test('коэффициент Дайса', () => {
  expect(dice('Game of Thrones', 'game of thrones')).toBe(1);
  expect(dice('abc', 'xyz')).toBe(0);
  expect(dice('Breaking Bear', 'The Bear')).toBeLessThan(0.5);
});

test('тот же сериал', () => {
  const r = matchRelease(parsed('Game of Thrones / S1E1-10 of 10 [2011, BDRip 1080p] Dub'), 21.5 * GB, got);
  expect(r.level).toBe('match');
  expect(r.score).toBeGreaterThanOrEqual(0.8);
});

test('похожее название, другой год — не «подходит»', () => {
  expect(matchRelease(parsed('Game of Thrones: Conquest & Rebellion [2017, WEB-DL 1080p]'), 2 * GB, got).level).not.toBe('match');
});

test('другой сериал — отклонён', () => {
  const bear: TitleInfo = { names: ['Медведь', 'The Bear'], year: 2022, kind: 'series', seasons: [{ number: 1, episodeCount: 8, year: 2022 }] };
  expect(matchRelease(parsed('Breaking Bear - S1E1-8 - 2026  MVO (RuDub) WEBDL 720p', 720), 1.9 * GB, bear).level).toBe('reject');
});

test('причины: нет сезона, серий больше, неправдоподобный размер', () => {
  expect(matchRelease(parsed('Game of Thrones / S3E1-10 of 10 [2013, WEB-DL 1080p]'), 20 * GB, got).reasons).toContain('Такого сезона нет');
  expect(matchRelease(parsed('Game of Thrones / S1E1-12 of 12 [2011, WEB-DL 1080p]'), 20 * GB, got).reasons).toContain('Серий больше, чем в сезоне');
  expect(matchRelease(parsed('Game of Thrones / S1E1-10 of 10 [2011, WEB-DL 1080p]'), 300 * GB, got).reasons).toContain('Размер на серию неправдоподобен');
});

test('правила пользователя', () => {
  const p = parsed('Совсем другое название S01E01');
  expect(matchRelease(p, GB, got, 'match')).toEqual({ score: 1, level: 'match', reasons: ['Подтверждено вручную'], rule: 'match' });
  expect(matchRelease(parsed('Game of Thrones / S1E1-10 of 10 [2011]'), 20 * GB, got, 'reject')).toEqual({
    score: 0,
    level: 'reject',
    reasons: ['В чёрном списке'],
    rule: 'reject',
  });
});

test('сквозные серии дальше, чем знает TMDB, — в сезон, где начинаются', () => {
  const t: TitleInfo = { names: ['X'], year: 2024, kind: 'anime', seasons: [{ number: 1, episodeCount: 12, year: 2024 }, { number: 2, episodeCount: 12, year: 2025 }] };
  expect(resolveAbsolute(parsed('X / E13-E25 X'), t)).toMatchObject({ seasons: [2], episodes: { from: 1, to: 13 }, absolute: false });
});

test('«S3E1 - 2025» — одна серия, «- 2025» — год', () => {
  expect(parseEpisodes('Kusuriya no Hitorigoto - S3E1 - 2025  DUB (DEEP), Sub HEVC WEBRip 1080p - RUSSIAN')).toMatchObject({ seasons: [3], episodes: { from: 1, to: 1 } });
  expect(parseEpisodes('Show - S2E1-24 - 2025  2 x DUB')).toMatchObject({ seasons: [2], episodes: { from: 1, to: 24 } });
});

test('год раздачи — любой из лет выхода сериала, не только год начала', () => {
  const t: TitleInfo = { names: ['Kusuriya no Hitorigoto'], year: 2023, lastYear: 2025, kind: 'anime', seasons: [{ number: 1, episodeCount: 60, year: 2023 }] };
  expect(matchRelease(parsed('Kusuriya no Hitorigoto [2025, WEBRip 1080p]'), 5 * GB, t).reasons).not.toContain('Год не совпадает');
  expect(matchRelease(parsed('Kusuriya no Hitorigoto [2019, WEBRip 1080p]'), 5 * GB, t).reasons).toContain('Год не совпадает');
});

test('аниме: один длинный сезон в TMDB делится на сезоны трекеров по перерывам в эфире', () => {
  const air = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 7 * 86_400_000).toISOString().slice(0, 10));
  const dates = [...air('2023-10-22', 24), ...air('2025-01-10', 24), ...air('2025-10-03', 12)];
  expect(coursOf(dates)).toEqual([24, 24, 12]);
  const t: TitleInfo = { names: ['X'], year: 2023, kind: 'anime', seasons: [{ number: 1, episodeCount: 60, year: 2023 }], cours: [24, 24, 12] };
  expect(resolveCours(parsed('X - S3E1 - 2025 DUB'), t)).toMatchObject({ seasons: [1], episodes: { from: 49, to: 49 } });
  expect(resolveCours(parsed('X - S2E1-24 - 2025 DUB'), t)).toMatchObject({ seasons: [1], episodes: { from: 25, to: 48 } });
  expect(resolveCours(parsed('X 2nd Season / Season 2 [WEBRip 1080p]'), t)).toMatchObject({ seasons: [1], episodes: { from: 25, to: 48 } });
  // сезон есть в TMDB или это не аниме — без изменений
  const p = parsed('X - S1E5 DUB');
  expect(resolveCours(p, t)).toBe(p);
});

test('сезон в скобках: «[S01 + Specials]», «[S01-02 + Specials]»', () => {
  expect(parseEpisodes('Монолог фармацевта / Kusuriya no Hitorigoto [S01 + Specials] (2023-2024) BDRip-HEVC 1080p').seasons).toEqual([1]);
  expect(parseEpisodes('Монолог фармацевта / Kusuriya no Hitorigoto [S01-02 + Specials] (2023-2025) BDRip-HEVC 1080p').seasons).toEqual([1, 2]);
});

test('аниме с одним сезоном в TMDB: пак сезона трекера — только его серии', () => {
  const t: TitleInfo = { names: ['X'], year: 2023, kind: 'anime', seasons: [{ number: 1, episodeCount: 60, year: 2023 }], cours: [24, 24, 12] };
  expect(resolveCours(parsed('X [S01 + Specials] (2023-2024) BDRip'), t)).toMatchObject({ seasons: [1], episodes: { from: 1, to: 24 } });
  expect(resolveCours(parsed('X [S01-02 + Specials] (2023-2025) BDRip'), t)).toMatchObject({ seasons: [1], episodes: { from: 1, to: 48 } });
  expect(resolveCours(parsed('X - S1E5 DUB'), t)).toMatchObject({ seasons: [1], episodes: { from: 5, to: 5 } });
});

test('названия через «|» — отдельные варианты', () => {
  expect(parseNames('Kusuriya no Hitorigoto | The Apothecary Diaries | Записки аптекаря [2023, TV, 24 из 24]').names).toEqual(['Kusuriya no Hitorigoto', 'The Apothecary Diaries', 'Записки аптекаря']);
});
