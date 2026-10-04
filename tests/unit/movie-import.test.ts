import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers';
import { fakeQbit } from './fake-qbit';
import { bencode } from '@/lib/torrent-file';
import { startRelease, syncDownloads } from '@/lib/downloads';
import { setSetting } from '@/lib/settings';
import { DEFAULT_MOVIE_PROFILE } from '@/lib/movie-profile';
import type { Runner } from '@/lib/media/runner';
import { downloads, episodeFiles, oldCopies, releases, sources, subscriptions, titles, type Release } from '@/lib/db/schema';
import type { ParsedRelease } from '@/lib/parse/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const b = (s: string) => Buffer.from(s);
const MB = 1024 ** 2;
function torrent(name: string, files: [string, number][]) {
  const info = new Map<string, unknown>([['name', b(name)], ['piece length', 1], ['pieces', Buffer.alloc(20)], ['files', files.map(([p, len]) => new Map<string, unknown>([['length', len], ['path', p.split('/').map(b)]]))]]);
  return bencode(new Map<string, unknown>([['info', info]]));
}
const parsed = (o: Partial<ParsedRelease> = {}): ParsedRelease => ({
  base: 'x', names: ['The Matrix'], year: 1999, seasons: [], episodes: null, totalInSeason: null, absolute: false, pack: false,
  resolution: 1080, source: 'webdl', hdr: false, dv: false, screener: false, dubs: [{ kind: 'dub', studioId: null, label: 'DUB', by: 'none' }], original: true, subs: false, ...o,
});
const HOUR = 3_600_000;
const NAME = 'The.Matrix.1999.1080p';
const FILES: [string, number][] = [
  ['Sample/sample.mkv', 5 * MB],
  ['The.Matrix.1999.1080p.mkv', 900 * MB],
  ['Extras/Making.of.mkv', 200 * MB],
  ['Subs/The.Matrix.1999.rus.srt', 1],
];

function setup(o: { movies?: boolean } = {}) {
  const db = testDb();
  const root = mkdtempSync(path.join(tmpdir(), 'dy-movie-'));
  const local = path.join(root, 'downloads');
  const media = path.join(root, 'media');
  const movies = path.join(root, 'movies');
  for (const d of [local, media, movies]) mkdirSync(d, { recursive: true });
  const t = db.insert(titles).values({ tmdbId: 603, tmdbType: 'movie', kind: 'movie', nameRu: 'Матрица', nameOriginal: 'The Matrix', originalLanguage: 'en', year: 1999, status: 'released', runtime: 136, createdAt: 1, refreshedAt: 1 }).returning().get();
  db.insert(subscriptions).values({ titleId: t.id, profile: DEFAULT_MOVIE_PROFILE, subscribedAt: 1, updatedAt: 1 }).run();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const mk = (title: string, p: Partial<ParsedRelease> = {}) =>
    db.insert(releases).values({ titleId: t.id, sourceId: s.id, trackerName: 'X', title, size: 100, firstSeenAt: 1, lastSeenAt: 1, parsed: parsed(p), match: { score: 1, level: 'match', reasons: [] } }).returning().get();
  const fq = fakeQbit();
  const files = new Map<number, Buffer>();
  const paths = { qbitDownloads: '/downloads', downloads: local, media, ...(o.movies === false ? {} : { movies }) };
  const deps = { qbit: fq.qbit, fetchTorrent: async (r: Release) => files.get(r.id)!, paths, now: 0 };
  const finish = (hash: string) => {
    const tor = fq.torrents.get(hash)!;
    for (const f of tor.files) {
      if (f.priority === 0) continue;
      f.progress = 1;
      const p = path.join(local, 'dublyarr', f.name);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, 'video');
    }
    tor.progress = 1;
  };
  return { db, t, mk, fq, files, deps, paths, movies, media, finish };
}

test('раздача фильма: включён только основной файл и субтитры; импорт в папку фильмов по шаблону', async () => {
  const s = setup();
  const r = s.mk('The Matrix [1999, WEB-DL 1080p] Dub');
  s.files.set(r.id, torrent(NAME, FILES));
  const d = await startRelease(s.db, s.deps, r, [{ season: 0, number: 0 }], 'movie', 'Дубляж', { dubPosition: 0 });
  const on = s.fq.torrents.get(d.hash)!.files.filter((f) => f.priority > 0).map((f) => f.name);
  expect(on).toEqual([`${NAME}/The.Matrix.1999.1080p.mkv`, `${NAME}/Subs/The.Matrix.1999.rus.srt`]);
  s.finish(d.hash);
  expect(await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: HOUR })).toMatchObject({ imported: 1 });
  const ef = s.db.select().from(episodeFiles).get()!;
  expect(ef).toMatchObject({ season: 0, number: 0, path: 'Матрица (1999)/Матрица (1999) [Дубляж 1080p].mkv', dubPosition: 0, studioLabel: 'Дубляж' });
  expect(existsSync(path.join(s.movies, ef.path))).toBe(true);
  expect(readdirSync(s.media)).toEqual([]);
  expect(s.db.select().from(downloads).get()!.state).toBe('imported');
});

test('раздача-диск — ошибка загрузки, торрент убран', async () => {
  const s = setup();
  const r = s.mk('The Matrix [1999, BR-DISK] Dub');
  s.files.set(r.id, torrent('MATRIX', [['BDMV/STREAM/00001.m2ts', 900 * MB], ['BDMV/index.bdmv', 1]]));
  const d = await startRelease(s.db, s.deps, r, [{ season: 0, number: 0 }], 'movie', 'Дубляж', { dubPosition: 0 });
  expect(d).toMatchObject({ state: 'error', lastError: 'Диск, а не файл' });
  expect(s.fq.torrents.has(d.hash)).toBe(false);
});

test('замена на дубляж: прежний файл — старая копия в папке фильмов', async () => {
  const s = setup();
  const r1 = s.mk('The Matrix [1999, WEB-DL 1080p] MVO');
  s.files.set(r1.id, torrent(NAME, FILES));
  const d1 = await startRelease(s.db, s.deps, r1, [{ season: 0, number: 0 }], 'movie', 'Многоголосый', { dubPosition: 1 });
  s.finish(d1.hash);
  await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: HOUR });
  const r2 = s.mk('The Matrix [1999, WEB-DL 1080p] Dub');
  s.files.set(r2.id, torrent(`${NAME}.DUB`, FILES));
  const d2 = await startRelease(s.db, s.deps, r2, [{ season: 0, number: 0 }], 'movie', 'Дубляж', { dubPosition: 0, note: 'Улучшение: многоголосый → дубляж' });
  s.finish(d2.hash);
  await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: 2 * HOUR });
  expect(s.db.select().from(episodeFiles).get()).toMatchObject({ path: 'Матрица (1999)/Матрица (1999) [Дубляж 1080p].mkv', dubPosition: 0 });
  const oc = s.db.select().from(oldCopies).get()!;
  expect(oc).toMatchObject({ season: 0, number: 0, reason: 'многоголосый → дубляж' });
  expect(existsSync(path.join(s.movies, oc.path))).toBe(true);
  expect(existsSync(path.join(s.movies, 'Матрица (1999)/Матрица (1999) [Многоголосый 1080p].mkv'))).toBe(false);
});

test('пересборка фильма: дорожка «Дубляж» — нужная; длительность сверяется с фильмом', async () => {
  const probe = (min: number) => ({
    streams: [
      { index: 0, codec_name: 'h264', codec_type: 'video', width: 1920, height: 1080, disposition: { default: 1 }, tags: {} },
      { index: 1, codec_name: 'ac3', codec_type: 'audio', channels: 6, disposition: { default: 1 }, tags: { language: 'rus', title: 'MVO Jaskier' } },
      { index: 2, codec_name: 'ac3', codec_type: 'audio', channels: 6, disposition: { default: 0 }, tags: { language: 'rus', title: 'Dub (Movie Dubbing)' } },
      { index: 3, codec_name: 'aac', codec_type: 'audio', channels: 2, disposition: { default: 0 }, tags: { language: 'eng', title: 'Original' } },
    ],
    format: { format_name: 'matroska,webm', duration: String(min * 60) },
  });
  const runner = (min: number) => {
    const calls: string[][] = [];
    const r: Runner = {
      available: async () => ({ ffprobe: true, mkvmerge: true }),
      probe: async () => probe(min),
      identify: async () => null,
      async mkvmerge(args) {
        calls.push(args);
        writeFileSync(args[1], 'пересобрано');
        return { code: 0, output: '' };
      },
    };
    return { r, calls };
  };
  const s = setup();
  setSetting(s.db, 'processing', { external: false });
  const r = s.mk('The Matrix [1999, WEB-DL 1080p] Dub + MVO');
  s.files.set(r.id, torrent(NAME, FILES));
  const d = await startRelease(s.db, s.deps, r, [{ season: 0, number: 0 }], 'movie', 'Дубляж', { dubPosition: 0 });
  s.finish(d.hash);
  const ok = runner(130);
  await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: HOUR, runner: ok.r });
  expect(ok.calls[0]).toEqual(expect.arrayContaining(['--audio-tracks', '2,3']));
  expect(s.db.select().from(episodeFiles).get()).toMatchObject({ processed: true });

  const w = setup();
  const r2 = w.mk('The Matrix [1999, WEB-DL 1080p] Dub');
  w.files.set(r2.id, torrent(NAME, FILES));
  const d2 = await startRelease(w.db, w.deps, r2, [{ season: 0, number: 0 }], 'movie', 'Дубляж', { dubPosition: 0 });
  w.finish(d2.hash);
  await syncDownloads(w.db, { qbit: w.fq.qbit, paths: w.paths, now: HOUR, runner: runner(45).r });
  expect(w.db.select().from(downloads).where(eq(downloads.id, d2.id)).get()).toMatchObject({ state: 'error', lastError: 'Не тот фильм: 45 мин вместо ~136 мин' });
});

test('папки фильмов нет — импорт не идёт, понятная ошибка', async () => {
  const s = setup({ movies: false });
  const r = s.mk('The Matrix [1999, WEB-DL 1080p] Dub');
  s.files.set(r.id, torrent(NAME, FILES));
  const d = await startRelease(s.db, s.deps, r, [{ season: 0, number: 0 }], 'movie', 'Дубляж', { dubPosition: 0 });
  s.finish(d.hash);
  await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: HOUR });
  expect(s.db.select().from(downloads).get()!.lastError).toBe('Ошибка импорта: не задана папка фильмов');
});

test('раздача-магнет фильма: ждём метаданные, затем выбираем основной файл', async () => {
  const s = setup();
  const r = s.mk('The Matrix [1999, WEB-DL 1080p] Dub');
  const hash = 'c'.repeat(40);
  const deps = { ...s.deps, fetchTorrent: async () => ({ magnet: `magnet:?xt=urn:btih:${hash}` }) };
  const d = await startRelease(s.db, deps, r, [{ season: 0, number: 0 }], 'movie', 'Дубляж', { dubPosition: 0 });
  expect(d.state).toBe('adding');
  // qBittorrent получил метаданные
  const tor = s.fq.torrents.get(hash)!;
  tor.files = FILES.map(([name, size], index) => ({ index, name: `${NAME}/${name}`, size, progress: 0, priority: 1 }));
  await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: HOUR });
  expect(s.db.select().from(downloads).get()).toMatchObject({ state: 'downloading' });
  expect(tor.files.filter((f) => f.priority > 0).map((f) => f.name)).toEqual([`${NAME}/The.Matrix.1999.1080p.mkv`, `${NAME}/Subs/The.Matrix.1999.rus.srt`]);
});
