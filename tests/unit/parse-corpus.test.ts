import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseEpisodes, parseQuality } from '@/lib/parse/index';

// Реальные заголовки (tests/fixtures/releases/hub-corpus.tsv): разбор не падает, а для известных — ожидаемые сезоны и качество.
const rows = readFileSync('tests/fixtures/releases/hub-corpus.tsv', 'utf8')
  .split('\n')
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [tracker, title, size, tags] = l.split('\t');
    return { tracker, title, size: Number(size), tags: (tags ?? '').split(',').map((s) => s.trim()).filter(Boolean) };
  });

const expected: [string, number[], number | null][] = [
  ['Severance / S1E1-9 of 9 [2022, WEB-DL 1080p] Dub', [1], 1080],
  ['Severance / S2E1-10 of 10 [2025, HDR10', [2], 2160],
  ['Severance - S1-2E1-19 - 2022-2025  MVO (LostFilm)  WEBDL', [1, 2], null],
  ['Severance - S2 - rus 720p WEBDL (LostFilm)', [2], 720],
  ['The Bear - S5E8 - The Original Beef of Chicagoland - rus 1080p', [5], 1080],
  ['Разделение (Severance)S2E01-10 (HD 1080p WEBRip)', [2], 1080],
  ['Одни из нас (The Last of Us)S2E01-07', [2], 1080],
  ['Rick and Morty / S1E1-21 of 21 [2013-2015, BDRip 1080p]', [1], 1080],
  ['Rick and Morty - S8E1-10 - 2025  3 x MVO', [8], 1080],
  ['The Last of Us - S2E1-7 - 2025  DUB (Red Head Sound), Sub 4K', [2], 2160],
  ['Sousou no Frieren  S02E01-E10 [RUS] [HDTV 1080p]', [2], 1080],
  ['(S2) / Sousou no Frieren 2nd Season', [2], 1080],
  ['Провожающая в последний путь Фрирен 2 / E01-E10', [2], 1080],
  ['Медведь и жрица / E01-E12 Kuma Miko', [], 720],
];

test('весь корпус разбирается без ошибок', () => {
  expect(rows.length).toBeGreaterThan(50);
  for (const r of rows) {
    expect(() => parseEpisodes(r.title)).not.toThrow();
    expect(() => parseQuality(r.title, r.tags)).not.toThrow();
  }
});

test.each(expected)('%s', (prefix, seasons, resolution) => {
  const r = rows.find((x) => x.title.startsWith(prefix));
  expect(r, prefix).toBeDefined();
  expect(parseEpisodes(r!.title).seasons).toEqual(seasons);
  expect(parseQuality(r!.title, r!.tags).resolution).toBe(resolution);
});
