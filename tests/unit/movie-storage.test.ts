import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDb } from './helpers';
import { fakeQbit } from './fake-qbit';
import { retentionPlan, runRetention } from '@/lib/retention';
import { DEFAULT_RETENTION, type RetentionSettings } from '@/lib/retention-settings';
import { checkDisk, fullestDisk, storageData, type Disk } from '@/lib/storage';
import { deleteSeries } from '@/lib/delete-series';
import { confirmOldCopies } from '@/lib/old-copies';
import { setSetting } from '@/lib/settings';
import { DEFAULT_MOVIE_PROFILE } from '@/lib/movie-profile';
import { episodeFiles, oldCopies, subscriptions, titles } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const DAY = 86_400_000;
const GB = 1024 ** 3;
const NOW = Date.parse('2026-10-01T12:00:00Z');
const REL = 'Матрица (1999)/Матрица (1999) [Дубляж 1080p].mkv';

function setup(o: { autoDelete?: boolean; path?: string } = {}) {
  const db = testDb();
  const root = mkdtempSync(path.join(tmpdir(), 'dy-mst-'));
  const media = path.join(root, 'media');
  const movies = path.join(root, 'movies');
  for (const d of [media, movies]) mkdirSync(d, { recursive: true });
  const t = db.insert(titles).values({ tmdbId: 603, tmdbType: 'movie', kind: 'movie', nameRu: 'Матрица', nameOriginal: 'The Matrix', originalLanguage: 'en', year: 1999, status: 'released', createdAt: 1, refreshedAt: 1 }).returning().get();
  db.insert(subscriptions).values({ titleId: t.id, profile: DEFAULT_MOVIE_PROFILE, subscribedAt: 1, updatedAt: 1, autoDelete: o.autoDelete ?? false }).run();
  const rel = o.path ?? REL;
  mkdirSync(path.dirname(path.join(movies, REL)), { recursive: true });
  writeFileSync(path.join(movies, REL), 'x');
  db.insert(episodeFiles).values({ titleId: t.id, season: 0, number: 0, path: rel, size: 20 * GB, method: 'hardlink', importedAt: NOW - 40 * DAY, dubPosition: 0, resolution: 1080, studioLabel: 'Дубляж' }).run();
  return { db, t, media, movies, roots: { media, movies } };
}
const on = (o: Partial<RetentionSettings> = {}): RetentionSettings => ({ ...DEFAULT_RETENTION, seasons: { on: true, keep: 1, ended: 'clean' }, ...o });

describe('правила хранения и фильмы', () => {
  test('правило сезонов фильм не трогает', () => {
    const s = setup();
    expect(retentionPlan(s.db, on(), NOW, '2026-10-01')).toEqual([]);
  });
  test('«через N дней» удаляет файл фильма в папке фильмов', async () => {
    const s = setup({ autoDelete: true });
    setSetting(s.db, 'retention.age.confirmed', true);
    expect(await runRetention(s.db, s.roots, on(), NOW)).toMatchObject({ deleted: 1, freed: 20 * GB });
    expect(existsSync(path.join(s.movies, REL))).toBe(false);
    expect(existsSync(path.join(s.movies, 'Матрица (1999)'))).toBe(false);
  });
  test('путь фильма вне папки фильмов — отказ', async () => {
    const s = setup({ autoDelete: true, path: '../media/x.mkv' });
    writeFileSync(path.join(s.media, 'x.mkv'), 'чужой');
    setSetting(s.db, 'retention.age.confirmed', true);
    expect((await runRetention(s.db, s.roots, on(), NOW)).deleted).toBe(0);
    expect(existsSync(path.join(s.media, 'x.mkv'))).toBe(true);
  });
  test('папка фильмов не задана — файлы фильмов не трогаются', async () => {
    const s = setup({ autoDelete: true });
    setSetting(s.db, 'retention.age.confirmed', true);
    expect((await runRetention(s.db, { media: s.media }, on(), NOW)).deleted).toBe(0);
    expect(existsSync(path.join(s.movies, REL))).toBe(true);
  });
  test('старые копии фильма — в скрытой папке фильмов', async () => {
    const s = setup();
    mkdirSync(path.join(s.movies, '.dublyarr-old'), { recursive: true });
    writeFileSync(path.join(s.movies, '.dublyarr-old/old.mkv'), 'x');
    const oc = s.db.insert(oldCopies).values({ titleId: s.t.id, season: 0, number: 0, path: '.dublyarr-old/old.mkv', size: 1, reason: 'r', createdAt: 1 }).returning().get();
    expect((await confirmOldCopies(s.db, s.roots, [oc.id])).deleted).toBe(1);
    expect(existsSync(path.join(s.movies, '.dublyarr-old/old.mkv'))).toBe(false);
  });
});

test('удаление фильма «только файлы»', async () => {
  const s = setup();
  const fq = fakeQbit();
  await deleteSeries(s.db, { qbit: fq.qbit, paths: { downloads: '/tmp/none', media: s.media, movies: s.movies } }, s.t.id, 'files', NOW);
  expect(existsSync(path.join(s.movies, REL))).toBe(false);
  expect(s.db.select().from(episodeFiles).all()).toEqual([]);
  expect(s.db.select().from(subscriptions).all()).toHaveLength(1);
});

describe('«Хранилище» и диск', () => {
  test('сегмент «Фильмы» и строка фильма', () => {
    const s = setup({ autoDelete: true });
    const TB = 1024 ** 4;
    const d = storageData(s.db, { total: 8 * TB, used: 4 * TB, free: 4 * TB, pct: 50 }, on(), NOW, '2026-10-01');
    expect(d.segments.find((x) => x.name === 'Фильмы')?.size).toBe(20 * GB);
    expect(d.shows[0]).toMatchObject({ tmdbId: 603, kind: 'movie', title: 'Матрица', seasons: '', quality: '1080p', rule: 'через 30 дн' });
  });
  test('два тома: пауза по самому заполненному', () => {
    const s = setup();
    const v = (pct: number): Disk => ({ total: 100, used: pct, free: 100 - pct, pct });
    const disk = fullestDisk([v(50), v(98), null]);
    expect(disk?.pct).toBe(98);
    expect(checkDisk(s.db, disk, DEFAULT_RETENTION, NOW)).toBe('pause');
    expect(fullestDisk([null, null])).toBeNull();
  });
});
