import { expect, test } from 'vitest';
import { parseEpisodes, parseQuality, parseNames, baseOf, normalizeTitle } from '@/lib/parse/index';

test.each([
  ['Show S02E05 1080p', { seasons: [2], episodes: { from: 5, to: 5 }, pack: false }],
  ['Show.S02E05.1080p.WEB-DL', { seasons: [2], episodes: { from: 5, to: 5 }, pack: false }],
  ['Severance / S2E1-10 of 10 [2025, WEB-DL 1080p]', { seasons: [2], episodes: { from: 1, to: 10 }, totalInSeason: 10, pack: true }],
  ['Severance - S1-2E1-19 - 2022-2025  MVO', { seasons: [1, 2], episodes: { from: 1, to: 19 }, pack: true }],
  ['Severance - S2 - rus 1080p WEBDL (LostFilm)', { seasons: [2], episodes: null, pack: true }],
  ['The Bear - S5E8 - The Original Beef - rus 720p WEBDL (LostFilm)', { seasons: [5], episodes: { from: 8, to: 8 }, pack: false }],
  ['Медведь (The Bear)S5E00-08 (HD 1080p WEBRip) Полный S5', { seasons: [5], episodes: { from: 0, to: 8 }, pack: true }],
  ['Sousou no Frieren  S02E01-E10 [RUS] [HDTV 1080p]', { seasons: [2], episodes: { from: 1, to: 10 } }],
  ['(S2) / Sousou no Frieren 2nd Season / Frieren [TV] [E10 of 12]', { seasons: [2], episodes: { from: 1, to: 10 }, totalInSeason: 12 }],
  ['Провожающая в последний путь Фрирен / E01-E28 Sousou no Frieren - AniLiberty.TOP', { seasons: [], episodes: { from: 1, to: 28 }, absolute: true, pack: true }],
  ['Провожающая в последний путь Фрирен 2 / E01-E10 Sousou no Frieren 2nd Season', { seasons: [2], episodes: { from: 1, to: 10 }, absolute: false }],
  ['Криминальное прошлое / Сезон: 2 / Серии: 1-4 из 8 [WEB-DL 1080p]', { seasons: [2], episodes: { from: 1, to: 4 }, totalInSeason: 8 }],
  ['Rick and Morty / : 1-5 / E1-51 of 51 [2013-2021]', { seasons: [1, 2, 3, 4, 5] }],
  ['S1E1-146 of ??? [2009-2024, WEBRip 576p]', { seasons: [1], episodes: { from: 1, to: 146 } }],
  ['Rick and Morty / S2E10 of 10 [2015, BDRemux]', { seasons: [2], episodes: { from: 10, to: 10 }, totalInSeason: 10, pack: false }],
  ['Просто название', { seasons: [], episodes: null, pack: false }],
  // bitru: «N сезон (A-B из C)»
  ['Фонари 1 сезон (1-7 из 8) / Lanterns (2026) WEB-DL | 10-bit', { seasons: [1], episodes: { from: 1, to: 7 }, totalInSeason: 8, pack: true }],
  ['Фонари 1 сезон (1-5 из 8) / Lanterns (2026) WEB-DLRip', { seasons: [1], episodes: { from: 1, to: 5 }, totalInSeason: 8 }],
  // nnmclub: несколько сезонов «сезон 4-5, серии 39-63 из 63»
  ['American Horror Story (2014-2016) WEB-DLRip [H.264/1080p-HQ] (сезон 4-5, серии 39-63 из 63) (LostFilm)', { seasons: [4, 5], episodes: { from: 39, to: 63 }, pack: true }],
  ['American Horror Story (2026) WEB-DL [H.265/2160p] (сезон 13, серии 1-6 из 13) LostFilm', { seasons: [13], episodes: { from: 1, to: 6 }, totalInSeason: 13 }],
  // украинские трекеры: «серія»
  ['Ліхтарі / Lanterns (Сезон 1, серія 1-7) (2026) WEB-DL 1080p Ukr/Eng', { seasons: [1], episodes: { from: 1, to: 7 } }],
])('%s', (t, exp) => expect(parseEpisodes(t)).toMatchObject(exp));

test.each([
  ['[2025, HDR10, HDR10+, Dolby Vision, WEB-DL 2160p]', { resolution: 2160, source: 'webdl', hdr: true, dv: true }],
  ['DUB, Sub 4K, HEVC, HDR, DV P8 WEBDL', { resolution: 2160, hdr: true, dv: true, source: 'webdl' }],
  ['Sub Blu-Ray Remux 1080p - RUSSIAN', { resolution: 1080, source: 'remux' }],
  ['[2015, BDRemux, AI upscaled to 2160p]', { resolution: 2160, source: 'remux' }],
  ['[2022, BDRip 1080p]', { resolution: 1080, source: 'bdrip' }],
  ['(HD 720p WEBRip)', { resolution: 720, source: 'webrip' }],
  ['[HDTVRip 720p]', { resolution: 720, source: 'hdtv' }],
  ['[2009-2024, WEBRip 576p]', { resolution: 576, source: 'webrip' }],
  ['Movie 2026 CAMRip', { screener: true, source: 'cam' }],
  ['Movie.2026.TS.1080p', { screener: true }],
  ['Severance - S2 - rus WEBDL (LostFilm)', { resolution: null, source: 'webdl', screener: false }],
  ['Devils (TS Studio) S01', { screener: false }],
])('%s', (t, exp) => expect(parseQuality(t, [])).toMatchObject(exp));

test('теги Jackett дополняют качество', () => {
  expect(parseQuality('Show S01', ['1080p', 'WEB-DL', 'HDR'])).toMatchObject({ resolution: 1080, source: 'webdl', hdr: true });
  expect(parseQuality('Show S01', ['SD', 'WEBRip'])).toMatchObject({ resolution: null, source: 'webrip' });
});

test('названия, год и основа', () => {
  expect(parseNames('Severance / S2E1-10 of 10 [2025, WEB-DL 1080p] Dub')).toEqual({ names: ['Severance'], year: 2025 });
  expect(parseNames('Медведь (The Bear)S5E00-08 (HD 1080p WEBRip) Полный S5')).toEqual({ names: ['Медведь', 'The Bear'], year: null });
  expect(parseNames('Провожающая в последний путь Фрирен 2 / E01-E10 Sousou no Frieren 2nd Season - AniLiberty.TOP [WEB-DL 1080p]').names).toEqual([
    'Провожающая в последний путь Фрирен 2',
    'Sousou no Frieren 2nd Season',
  ]);
  expect(parseNames('(S2) / Sousou no Frieren 2nd Season / Frieren: Beyond Journey\'s End Season 2 [TV] [E10 of 12]').names).toEqual([
    'Sousou no Frieren 2nd Season',
    "Frieren: Beyond Journey's End Season 2",
  ]);
  expect(parseNames('Severance - S1E1-9 - 2022  MVO (LostFilm)')).toEqual({ names: ['Severance'], year: 2022 });
  expect(parseNames('The Bear - S5E8 - The Original Beef of Chicagoland - rus 1080p WEBDL (LostFilm)').names).toEqual(['The Bear']);
  expect(baseOf('Severance / S2E1-10 of 10 [2025, WEB-DL 1080p]')).toBe('severance');
  expect(baseOf('Медведь (The Bear)S5E00-08 (HD 1080p WEBRip)')).toBe('медведь');
  expect(normalizeTitle('Frieren: Beyond Journey’s End — Ёжик')).toBe('frieren beyond journeys end ежик');
});

test.each([
  ['Сериал / Show / Сезон: 2 / Серии: 1 из 8 [WEB-DL 1080p]', { seasons: [2], episodes: { from: 1, to: 1 }, totalInSeason: 8, pack: false }],
  ['Сериал / Show / Сезон: 2 / Серия: 5 [WEB-DL 1080p]', { seasons: [2], episodes: { from: 5, to: 5 }, pack: false }],
])('одна серия в русском формате: %s', (t, exp) => expect(parseEpisodes(t)).toMatchObject(exp));

test('названия в скобках через запятую — отдельные варианты', () => {
  expect(parseNames('Dogulwang (Toukutsu Ou, Tomb Raider King) - E1-12 - 2026  DUB (IVI), Sub WEBDL 1080p - RUSSIAN').names).toEqual(['Dogulwang', 'Toukutsu Ou', 'Tomb Raider King']);
  // пометка страны или года в скобках — не название
  expect(parseNames('Shameless (US) / S01E01 [2011, WEB-DL 1080p]').names).toEqual(['Shameless (US)']);
});

test('названия: baibako «A /B /s02e01-12 /…», bitru «A 4 сезон (1-8 из 10) / B (2026) …» — без сезона, качества и подписей', () => {
  expect(parseNames('Тед Лассо /Ted Lasso /s02e01-12 /HD720p WEBRip /Полный 2 сезон')).toEqual({ names: ['Тед Лассо', 'Ted Lasso'], year: null });
  expect(parseNames('Тед Лассо 4 сезон (1-8 из 10) / Ted Lasso (2026) WEB-DL | от Ultradox')).toEqual({ names: ['Тед Лассо', 'Ted Lasso'], year: 2026 });
  expect(parseNames('Фонари 1 сезон (1-8 из 8) / Lanterns (2026) WEB-DL | 4К, HDR10+, 10-bit | от Мастер 5')).toEqual({ names: ['Фонари', 'Lanterns'], year: 2026 });
  // «AC/DC» без пробела перед слешем — одно название
  expect(parseNames('AC/DC: Live at River Plate [2011, BDRip]').names).toEqual(['AC/DC: Live at River Plate']);
});
