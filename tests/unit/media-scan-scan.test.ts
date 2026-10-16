import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDb } from './helpers';
import { runMediaScan } from '@/lib/media-scan/scan';
import { getScanState } from '@/lib/media-scan/state';
import { episodeFiles, titles } from '@/lib/db/schema';

test('обход: файлы Dublyarr, .dublyarr-old, служебное — мимо; новые серии сериала из библиотеки — в его позицию; результат сохраняется', async () => {
  const db = testDb();
  const media = mkdtempSync(path.join(tmpdir(), 'dy-scan-'));
  const put = (rel: string) => (mkdirSync(path.dirname(path.join(media, rel)), { recursive: true }), writeFileSync(path.join(media, rel), 'v'));
  put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  put('Фонари (2026)/Season 01/Фонари S01E01 [LostFilm 1080p].mkv');
  put('Фонари (2026)/Season 01/Фонари S01E09 [LostFilm 1080p].mkv'); // новая, не в базе
  put('.dublyarr-old/A (2020)/Season 01/A S01E01.mkv');
  put('@eaDir/x.mkv');
  const t = db.insert(titles).values({ tmdbId: 95350, tmdbType: 'tv', kind: 'series', nameRu: 'Фонари', nameOriginal: 'Lanterns', year: 2026, originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: 1, path: 'Фонари (2026)/Season 01/Фонари S01E01 [LostFilm 1080p].mkv', size: 1, method: 'hardlink', importedAt: 1 }).run();
  const search = async () => [{ tmdbId: 125988, type: 'tv' as const, name: 'Укрытие', original: 'Silo', year: 2023, posterPath: null, score: 0 }];
  const s = await runMediaScan(db, { tmdb: null, paths: { downloads: media, media }, search });
  expect(s.items.map((i) => [i.key, i.candidate?.tmdbId, i.episodes.length])).toEqual([
    ['Silo', 125988, 1],
    ['Фонари (2026)', 95350, 1],
  ]);
  expect(s.items[1]).toMatchObject({ sure: true, have: [] });
  expect(getScanState(db).items).toHaveLength(2);
});

test('добавление: позиция уходит из найденного, итог — в состояние; qBittorrent нет — жёсткие ссылки', async () => {
  const { runAdopt } = await import('@/lib/media-scan/scan');
  const { seedStudios } = await import('@/lib/studios');
  const db = testDb();
  seedStudios(db);
  const media = mkdtempSync(path.join(tmpdir(), 'dy-scan-'));
  mkdirSync(path.join(media, 'Silo/Season 03'), { recursive: true });
  writeFileSync(path.join(media, 'Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv'), 'v');
  db.insert(titles).values({ tmdbId: 125988, tmdbType: 'tv', kind: 'series', nameRu: 'Укрытие', nameOriginal: 'Silo', year: 2023, originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: Date.now() }).run();
  const search = async () => [{ tmdbId: 125988, type: 'tv' as const, name: 'Укрытие', original: 'Silo', year: 2023, posterPath: null, score: 0 }];
  const s = await runMediaScan(db, { tmdb: null, paths: { downloads: media, media }, search });
  const it = s.items[0];
  const lines = await runAdopt(
    db,
    { tmdb: null, runner: { available: async () => ({ ffprobe: false, mkvmerge: false }) } as never, paths: { downloads: media, media }, now: 7, userCanSubscribe: true, qbit: null },
    [{ key: it.key, root: it.root, tmdbId: 125988, type: 'tv', filesOnly: true, process: false, episodes: it.episodes }],
  );
  expect(lines).toEqual([expect.objectContaining({ key: 'Silo', added: 1, left: 1 })]); // жёсткая ссылка — оригинал остался
  const st = getScanState(db);
  expect(st).toMatchObject({ status: 'idle', items: [], last: { at: 7 } });
  expect(db.select().from(episodeFiles).get()!.method).toBe('hardlink');
});
