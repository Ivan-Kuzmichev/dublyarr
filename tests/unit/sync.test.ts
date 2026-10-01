import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDb } from './helpers';
import { fakeQbit } from './fake-qbit';
import { bencode } from '@/lib/torrent-file';
import { startRelease, syncDownloads } from '@/lib/downloads';
import { downloads, episodeFiles, releases, sources, titles, wantedState, type Release } from '@/lib/db/schema';
import type { ParsedRelease } from '@/lib/parse/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const b = (s: string) => Buffer.from(s);
function torrent(name: string, files: string[] | null) {
  const info = new Map<string, unknown>([['name', b(name)], ['piece length', 1], ['pieces', Buffer.alloc(20)]]);
  if (files) info.set('files', files.map((f) => new Map<string, unknown>([['length', 100], ['path', [b(f)]]])));
  else info.set('length', 100);
  return bencode(new Map<string, unknown>([['info', info]]));
}
const parsed = (o: Partial<ParsedRelease>): ParsedRelease => ({
  base: 'x', names: [], year: null, seasons: [1], episodes: null, totalInSeason: null, absolute: false, pack: true,
  resolution: 1080, source: 'webdl', hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false, ...o,
});
const HOUR = 3_600_000;

function setup() {
  const db = testDb();
  const root = mkdtempSync(path.join(tmpdir(), 'dy-sync-'));
  const local = path.join(root, 'downloads');
  const media = path.join(root, 'media');
  mkdirSync(local, { recursive: true });
  mkdirSync(media, { recursive: true });
  const t = db.insert(titles).values({ tmdbId: 1399, kind: 'series', nameRu: 'Игра престолов', nameOriginal: 'Game of Thrones', originalLanguage: 'en', year: 2011, status: 'ended', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const mk = (title: string, p: Partial<ParsedRelease>) =>
    db.insert(releases).values({ titleId: t.id, sourceId: s.id, trackerName: 'X', title, size: 100, firstSeenAt: 1, lastSeenAt: 1, parsed: parsed(p), match: { score: 1, level: 'match', reasons: [] } }).returning().get();
  const fq = fakeQbit();
  const files = new Map<number, Buffer>();
  const paths = { qbitDownloads: '/downloads', downloads: local, media };
  const deps = { qbit: fq.qbit, fetchTorrent: async (r: Release) => files.get(r.id)!, paths, now: 0 };
  /** «докачать»: прогресс 1 у включённых файлов и файлы на диске */
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
  return { db, t, mk, fq, files, deps, paths, media, finish };
}

test('прогресс обновляется; завершённая серия импортируется по шаблону', async () => {
  const { db, mk, fq, files, deps, paths, media, finish, t } = setup();
  const r = mk('GoT S01E03', { pack: false, episodes: { from: 3, to: 3 } });
  files.set(r.id, torrent('Game.of.Thrones.S01E03.mkv', null));
  db.insert(wantedState).values({ titleId: t.id, season: 1, number: 3, state: 'waiting', reason: 'x', checkedAt: 0 }).run();
  const d = await startRelease(db, deps, r, [{ season: 1, number: 3 }], 'episode', 'LostFilm');
  Object.assign(fq.torrents.get(d.hash)!, { progress: 0.5, dlspeed: 1000, eta: 60 });
  expect(await syncDownloads(db, { qbit: fq.qbit, paths, now: HOUR })).toMatchObject({ imported: 0 });
  expect(db.select().from(downloads).get()).toMatchObject({ progress: 0.5, dlSpeed: 1000, eta: 60, state: 'downloading' });
  finish(d.hash);
  expect(await syncDownloads(db, { qbit: fq.qbit, paths, now: 2 * HOUR })).toMatchObject({ imported: 1 });
  expect(db.select().from(downloads).get()).toMatchObject({ state: 'imported', importedAt: 2 * HOUR });
  const ef = db.select().from(episodeFiles).get()!;
  expect(ef).toMatchObject({ season: 1, number: 3, path: 'Игра престолов (2011)/Season 01/Игра престолов S01E03 [LostFilm 1080p].mkv', method: 'hardlink', studioLabel: 'LostFilm' });
  expect(existsSync(path.join(media, ef.path))).toBe(true);
  expect(db.select().from(wantedState).all()).toEqual([]);
});

test('пак: импортируются только нужные файлы', async () => {
  const { db, mk, files, deps, paths, media, finish, fq } = setup();
  const r = mk('GoT S01', {});
  files.set(r.id, torrent('GoT S01', ['Game.of.Thrones.S01E01.mkv', 'Game.of.Thrones.S01E02.mkv', 'Game.of.Thrones.S01E03.mkv']));
  const d = await startRelease(db, deps, r, [{ season: 1, number: 2 }], 'pack', 'LostFilm');
  finish(d.hash);
  await syncDownloads(db, { qbit: fq.qbit, paths, now: HOUR });
  expect(db.select().from(episodeFiles).all().map((e) => e.number)).toEqual([2]);
  expect(existsSync(path.join(media, 'Игра престолов (2011)/Season 01/Игра престолов S01E01 [LostFilm 1080p].mkv'))).toBe(false);
});

test('нет сидов больше суток — «застряла»; исчезла из клиента — «убрана»; пауза', async () => {
  const { db, mk, fq, files, deps, paths } = setup();
  const r = mk('GoT S01E01', { pack: false });
  files.set(r.id, torrent('Game.of.Thrones.S01E01.mkv', null));
  const d = await startRelease(db, deps, r, [{ season: 1, number: 1 }], 'episode', 'X');
  fq.torrents.get(d.hash)!.num_seeds = 0;
  await syncDownloads(db, { qbit: fq.qbit, paths, now: 23 * HOUR });
  expect(db.select().from(downloads).get()!.state).toBe('downloading');
  await syncDownloads(db, { qbit: fq.qbit, paths, now: 25 * HOUR });
  expect(db.select().from(downloads).get()!.state).toBe('stalled');
  fq.torrents.get(d.hash)!.state = 'stoppedDL';
  await syncDownloads(db, { qbit: fq.qbit, paths, now: 26 * HOUR });
  expect(db.select().from(downloads).get()!.state).toBe('paused');
  fq.torrents.clear();
  await syncDownloads(db, { qbit: fq.qbit, paths, now: 27 * HOUR });
  expect(db.select().from(downloads).get()!.state).toBe('removed');
});

test('ошибка импорта не теряет загрузку — повтор при следующей синхронизации', async () => {
  const { db, mk, fq, files, deps, paths, finish } = setup();
  const r = mk('GoT S01E01', { pack: false });
  files.set(r.id, torrent('Game.of.Thrones.S01E01.mkv', null));
  const d = await startRelease(db, deps, r, [{ season: 1, number: 1 }], 'episode', 'X');
  fq.torrents.get(d.hash)!.progress = 1; // файла на диске нет
  const res = await syncDownloads(db, { qbit: fq.qbit, paths, now: HOUR });
  expect(res.errors).toBe(1);
  expect(db.select().from(downloads).get()).toMatchObject({ state: 'completed' });
  expect(db.select().from(downloads).get()!.lastError).toMatch(/импорт/i);
  finish(d.hash);
  await syncDownloads(db, { qbit: fq.qbit, paths, now: 2 * HOUR });
  expect(db.select().from(downloads).get()!.state).toBe('imported');
});

test('путь qBittorrent вне папки загрузок — ошибка загрузки', async () => {
  const { db, mk, fq, files, deps, paths } = setup();
  const r = mk('GoT S01E01', { pack: false });
  files.set(r.id, torrent('Game.of.Thrones.S01E01.mkv', null));
  const d = await startRelease(db, deps, r, [{ season: 1, number: 1 }], 'episode', 'X');
  Object.assign(fq.torrents.get(d.hash)!, { progress: 1, save_path: '/elsewhere' });
  await syncDownloads(db, { qbit: fq.qbit, paths, now: HOUR });
  expect(db.select().from(downloads).get()!.lastError).toBe('Путь qBittorrent вне папки загрузок: /elsewhere/Game.of.Thrones.S01E01.mkv');
});

test('в паке сезона нет файла одной серии — остальные импортируются, загрузка завершена, серия «нет файла»', async () => {
  const { db, t, mk, fq, files, deps, paths, media, finish } = setup();
  const r = mk('Игра престолов S01', {});
  files.set(r.id, torrent('GoT S01', ['GoT.S01E01.mkv', 'GoT.S01E02.mkv']));
  const want = [1, 2, 3].map((number) => ({ season: 1, number }));
  const d = await startRelease(db, deps, r, want, 'season', 'LostFilm');
  finish(d.hash);
  await syncDownloads(db, { qbit: fq.qbit, paths, now: 50 });
  expect(db.select().from(downloads).get()).toMatchObject({ state: 'imported', episodes: want.slice(0, 2) });
  expect(db.select().from(episodeFiles).all()).toHaveLength(2);
  expect(existsSync(path.join(media, 'Игра престолов (2011)', 'Season 01'))).toBe(true);
  expect(db.select().from(wantedState).all()).toEqual([expect.objectContaining({ titleId: t.id, season: 1, number: 3, state: 'missing', reason: 'В раздаче нет файла S01E03' })]);
});
