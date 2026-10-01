import { describe, expect, test } from 'vitest';
import { setSetting } from '@/lib/settings';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import type { Runner } from '@/lib/media/runner';
import { cleanRemuxTmp } from '@/lib/media/process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDb } from './helpers';
import { fakeQbit } from './fake-qbit';
import { bencode } from '@/lib/torrent-file';
import { startRelease, syncDownloads } from '@/lib/downloads';
import { downloads, episodeFiles, episodes, notifications, oldCopies, studios, subscriptions, releases, sources, titles, wantedState, type Release } from '@/lib/db/schema';
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

test('сбой списка файлов у одной загрузки не мешает остальным', async () => {
  const { db, mk, fq, files, deps, paths, finish } = setup();
  const a = mk('GoT S01E01', { pack: false });
  const b2 = mk('GoT S01E02', { pack: false });
  files.set(a.id, torrent('Game.of.Thrones.S01E01.mkv', null));
  files.set(b2.id, torrent('Game.of.Thrones.S01E02.mkv', null));
  const da = await startRelease(db, deps, a, [{ season: 1, number: 1 }], 'episode', 'X');
  const db2 = await startRelease(db, deps, b2, [{ season: 1, number: 2 }], 'episode', 'X');
  finish(db2.hash);
  const qbit = { ...fq.qbit, files: async (h: string) => (h === da.hash ? Promise.reject(new Error('сбой')) : fq.qbit.files(h)) };
  const res = await syncDownloads(db, { qbit, paths, now: HOUR });
  expect(res).toMatchObject({ imported: 1, errors: 1 });
});

test('чужой файл по пути в медиатеке не затирается; своя серия — заменяется', async () => {
  const { db, mk, fq, files, deps, paths, media, finish } = setup();
  const r = mk('GoT S01E01', { pack: false });
  files.set(r.id, torrent('Game.of.Thrones.S01E01.mkv', null));
  const d = await startRelease(db, deps, r, [{ season: 1, number: 1 }], 'episode', 'X');
  const rel = 'Игра престолов (2011)/Season 01/Игра престолов S01E01 [X 1080p].mkv';
  mkdirSync(path.dirname(path.join(media, rel)), { recursive: true });
  writeFileSync(path.join(media, rel), 'чужое');
  finish(d.hash);
  await syncDownloads(db, { qbit: fq.qbit, paths, now: HOUR });
  expect(db.select().from(downloads).get()).toMatchObject({ state: 'completed', lastError: `Ошибка импорта: Файл уже есть в медиатеке: ${rel}` });
  expect(readFileSync(path.join(media, rel), 'utf8')).toBe('чужое');
  // это наш прошлый импорт той же серии — заменяем
  db.insert(episodeFiles).values({ titleId: d.titleId, season: 1, number: 1, path: rel, size: 1, method: 'copy', importedAt: 1 }).run();
  await syncDownloads(db, { qbit: fq.qbit, paths, now: 2 * HOUR });
  expect(db.select().from(downloads).get()!.state).toBe('imported');
  expect(readFileSync(path.join(media, rel), 'utf8')).toBe('video');
});

test('часть серий пака не импортировалась — уже импортированные не копируются заново', async () => {
  const { db, mk, fq, files, deps, paths, media, finish } = setup();
  const r = mk('Игра престолов S01', {});
  files.set(r.id, torrent('GoT S01', ['GoT.S01E01.mkv', 'GoT.S01E02.mkv']));
  const d = await startRelease(db, deps, r, [1, 2].map((number) => ({ season: 1, number })), 'pack', 'X');
  const rel = (n: number) => `Игра престолов (2011)/Season 01/Игра престолов S01E0${n} [X 1080p].mkv`;
  mkdirSync(path.dirname(path.join(media, rel(2))), { recursive: true });
  writeFileSync(path.join(media, rel(2)), 'чужое');
  finish(d.hash);
  await syncDownloads(db, { qbit: fq.qbit, paths, now: HOUR });
  expect(db.select().from(episodeFiles).all().map((f) => f.number)).toEqual([1]);
  expect(db.select().from(downloads).get()).toMatchObject({ state: 'completed' });
  rmSync(path.join(media, rel(1))); // новый файл (другой inode), чтобы повторная ссылка была заметна
  writeFileSync(path.join(media, rel(1)), 'изменён после импорта');
  await syncDownloads(db, { qbit: fq.qbit, paths, now: 2 * HOUR });
  expect(readFileSync(path.join(media, rel(1)), 'utf8')).toBe('изменён после импорта');
});

describe('старая копия после улучшения', () => {
  const run = async (o: { samePath?: boolean; confirmed?: boolean; fail?: boolean }) => {
    const s = setup();
    const { db, t, mk, fq, files, deps, paths, media, finish } = s;
    if (o.confirmed) setSetting(db, 'retention.oldCopy.confirmed', true);
    const label = o.samePath ? 'X' : 'Y';
    const oldRel = 'Игра престолов (2011)/Season 01/Игра престолов S01E01 [X 1080p].mkv';
    mkdirSync(path.dirname(path.join(media, oldRel)), { recursive: true });
    writeFileSync(path.join(media, oldRel), 'старая');
    db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: 1, path: oldRel, size: 6, method: 'copy', importedAt: 1, studioLabel: 'X', resolution: 1080, dubPosition: 1 }).run();
    const r = mk('GoT S01E01', { pack: false });
    files.set(r.id, torrent('Game.of.Thrones.S01E01.mkv', null));
    const d = await startRelease(db, deps, r, [{ season: 1, number: 1 }], 'episode', label, { dubPosition: 0, note: 'Улучшение: X → Y' });
    if (o.fail) fq.torrents.get(d.hash)!.progress = 1; // файла нет — импорт упадёт
    else finish(d.hash);
    await syncDownloads(db, { qbit: fq.qbit, paths, now: HOUR });
    return { ...s, oldRel, newRel: oldRel.replace('[X', `[${label}`) };
  };

  test('до подтверждения — в скрытую папку и в список', async () => {
    const { db, media, oldRel, newRel } = await run({});
    expect(readFileSync(path.join(media, newRel), 'utf8')).toBe('video');
    expect(existsSync(path.join(media, oldRel))).toBe(false);
    expect(readFileSync(path.join(media, '.dublyarr-old', oldRel), 'utf8')).toBe('старая');
    expect(db.select().from(oldCopies).all()).toEqual([expect.objectContaining({ path: `.dublyarr-old/${oldRel}`, size: Buffer.byteLength('старая'), reason: 'X → Y' })]);
    expect(db.select().from(episodeFiles).get()).toMatchObject({ path: newRel, dubPosition: 0 });
  });

  test('после подтверждения — удаляется сразу', async () => {
    const { db, media, oldRel } = await run({ confirmed: true });
    expect(existsSync(path.join(media, oldRel))).toBe(false);
    expect(existsSync(path.join(media, '.dublyarr-old', oldRel))).toBe(false);
    expect(db.select().from(oldCopies).all()).toEqual([]);
  });

  test('тот же путь — старая сначала уходит в скрытую папку, новая ложится', async () => {
    const { db, media, oldRel } = await run({ samePath: true });
    expect(readFileSync(path.join(media, oldRel), 'utf8')).toBe('video');
    expect(readFileSync(path.join(media, '.dublyarr-old', oldRel), 'utf8')).toBe('старая');
    expect(db.select().from(oldCopies).all()).toHaveLength(1);
  });

  test('импорт новой упал — старая на месте', async () => {
    const { db, media, oldRel } = await run({ samePath: true, fail: true });
    expect(readFileSync(path.join(media, oldRel), 'utf8')).toBe('старая');
    expect(db.select().from(episodeFiles).get()!.path).toBe(oldRel);
    expect(db.select().from(oldCopies).all()).toEqual([]);
  });
});

describe('уведомления о загрузках', () => {
  const texts = (db: ReturnType<typeof setup>['db']) => db.select().from(notifications).all().map((n) => n.text);
  test('скачана новая серия — одно сообщение; улучшение — своей строкой', async () => {
    const { db, mk, fq, files, deps, paths, finish } = setup();
    const r = mk('GoT S01', {});
    files.set(r.id, torrent('GoT S01', ['GoT.S01E01.mkv', 'GoT.S01E02.mkv']));
    const d = await startRelease(db, deps, r, [1, 2].map((number) => ({ season: 1, number })), 'pack', 'LostFilm');
    finish(d.hash);
    await syncDownloads(db, { qbit: fq.qbit, paths, now: HOUR });
    await syncDownloads(db, { qbit: fq.qbit, paths, now: 2 * HOUR });
    expect(texts(db)).toEqual(['📥 Игра престолов · S01E01–E02 — LostFilm 1080p']);
    const u = mk('GoT S01E03 2160', { pack: false, resolution: 2160 });
    files.set(u.id, torrent('GoT.S01E03.mkv', null));
    const d2 = await startRelease(db, deps, u, [{ season: 1, number: 3 }], 'episode', 'LostFilm', { note: 'Улучшение: 1080p → 2160p' });
    finish(d2.hash);
    await syncDownloads(db, { qbit: fq.qbit, paths, now: 3 * HOUR });
    expect(texts(db)[1]).toBe('📥 Игра престолов · S01E03 — Улучшено: 1080p → 2160p');
  });

  test('застряла и пропала — по одному сообщению', async () => {
    const { db, mk, fq, files, deps, paths } = setup();
    const r = mk('GoT S01E01', { pack: false });
    files.set(r.id, torrent('Game.of.Thrones.S01E01.mkv', null));
    const d = await startRelease(db, deps, r, [{ season: 1, number: 1 }], 'episode', 'X');
    fq.torrents.get(d.hash)!.num_seeds = 0;
    await syncDownloads(db, { qbit: fq.qbit, paths, now: 25 * HOUR });
    await syncDownloads(db, { qbit: fq.qbit, paths, now: 26 * HOUR });
    fq.torrents.clear();
    await syncDownloads(db, { qbit: fq.qbit, paths, now: 27 * HOUR });
    expect(texts(db)).toEqual(['⏳ Застряла: Игра престолов · S01E01 — нет сидов больше суток', '⚠️ Раздача пропала из qBittorrent: Игра престолов · S01E01']);
  });
});

describe('пересборка при импорте', () => {
  const probeJson = (o: { durationMin?: number; extraAudio?: boolean } = {}) => ({
    streams: [
      { index: 0, codec_name: 'h264', codec_type: 'video', width: 1920, height: 1080, color_transfer: 'smpte2084', disposition: { default: 1 }, tags: {} },
      { index: 1, codec_name: 'aac', codec_type: 'audio', channels: 2, disposition: { default: 1 }, tags: { language: 'eng', title: 'Original' } },
      ...(o.extraAudio === false ? [] : [{ index: 2, codec_name: 'ac3', codec_type: 'audio', channels: 6, disposition: { default: 0 }, tags: { language: 'rus', title: 'LostFilm' } }]),
    ],
    format: { format_name: 'matroska,webm', duration: String((o.durationMin ?? 50) * 60) },
  });
  function fakeRunner(o: { json?: unknown; code?: number; avail?: boolean } = {}) {
    const calls: string[][] = [];
    const runner: Runner = {
      available: async () => ({ ffprobe: o.avail !== false, mkvmerge: o.avail !== false }),
      probe: async () => o.json ?? probeJson(),
      async mkvmerge(args) {
        calls.push(args);
        if ((o.code ?? 0) >= 2) return { code: 2, output: 'Error: нет места на диске' };
        writeFileSync(args[1], 'пересобрано'); // «сборка» — новый файл по пути после -o
        void copyFileSync;
        return { code: 0, output: '' };
      },
    };
    return { runner, calls };
  }
  const start = async (s: ReturnType<typeof setup>) => {
    const studio = s.db.insert(studios).values({ name: 'LostFilm', kind: 'both', source: 'manual', createdAt: 1 }).returning().get();
    s.db.insert(subscriptions).values({ titleId: s.t.id, profile: { dubs: [{ kind: 'studio', studioId: studio.id, waitDays: 0 }], quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: null }, scope: { mode: 'all' }, wholeSeasonAfterFinale: false, replaceWithHigher: true, autoNextSeason: true }, subscribedAt: 1, updatedAt: 1 }).run();
    s.db.insert(episodes).values({ titleId: s.t.id, season: 1, number: 1, name: 'E1', airDate: '2011-04-17', runtime: 55 }).run();
    const r = s.mk('GoT S01E01', { pack: false });
    s.files.set(r.id, torrent('Game.of.Thrones.S01E01.mkv', null));
    const d = await startRelease(s.db, s.deps, r, [{ season: 1, number: 1 }], 'episode', 'LostFilm', { dubPosition: 0 });
    s.finish(d.hash);
    return d;
  };
  const rel = 'Игра престолов (2011)/Season 01/Игра престолов S01E01 [LostFilm 1080p].mkv';

  test('пересборка: в медиатеке новый файл, источник не тронут, сведения о файле', async () => {
    const s = setup();
    await start(s);
    const { runner, calls } = fakeRunner();
    await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: HOUR, runner });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.arrayContaining(['--audio-tracks', '2,1']));
    expect(readFileSync(path.join(s.media, rel), 'utf8')).toBe('пересобрано');
    expect(readFileSync(path.join(s.paths.downloads, 'dublyarr', 'Game.of.Thrones.S01E01.mkv'), 'utf8')).toBe('video');
    expect(s.db.select().from(episodeFiles).get()).toMatchObject({ path: rel, processed: true, hdr: true, resolution: 1080, duration: 3000 });
    expect(s.db.select().from(episodeFiles).get()!.tracks!.after.map((t) => t.name)).toEqual(['H264 1080p HDR', 'LostFilm 5.1', 'Original 2.0']);
    expect(readdirSync(path.dirname(path.join(s.media, rel))).filter((f) => f.includes('.dy-'))).toEqual([]);
  });

  test('менять нечего — жёсткая ссылка без пересборки', async () => {
    const s = setup();
    await start(s);
    const { runner, calls } = fakeRunner({ json: probeJson({ extraAudio: false }) }); // нужной озвучки нет — аудио не трогаем, субтитров нет
    await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: HOUR, runner });
    expect(calls).toEqual([]);
    expect(s.db.select().from(episodeFiles).get()).toMatchObject({ processed: false, method: 'hardlink' });
  });

  test('mkvmerge упал — временного файла нет, ошибка в загрузке', async () => {
    const s = setup();
    await start(s);
    const { runner } = fakeRunner({ code: 2 });
    await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: HOUR, runner });
    expect(s.db.select().from(downloads).get()!.lastError).toMatch(/mkvmerge.*нет места/);
    expect(s.db.select().from(episodeFiles).all()).toEqual([]);
    const dir = path.join(s.media, 'Игра престолов (2011)', 'Season 01');
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  test('не та серия — не импортируется, загрузка с ошибкой, торрент убран', async () => {
    const s = setup();
    const d = await start(s);
    const { runner } = fakeRunner({ json: probeJson({ durationMin: 150 }) });
    await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: HOUR, runner });
    expect(s.db.select().from(downloads).get()).toMatchObject({ state: 'error', lastError: 'Не та серия: 2 ч 30 мин вместо ~55 мин' });
    expect(s.fq.torrents.has(d.hash)).toBe(false);
    expect(s.db.select().from(episodeFiles).all()).toEqual([]);
  });

  test('программ нет — как раньше', async () => {
    const s = setup();
    await start(s);
    const { runner } = fakeRunner({ avail: false });
    await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: HOUR, runner });
    expect(s.db.select().from(episodeFiles).get()).toMatchObject({ processed: false, path: rel.replace('.mkv', '.mkv') });
  });
});

describe('пересборка: исправления по ревью', () => {
  const multiProbe = (container = 'matroska,webm') => ({
    streams: [
      { index: 0, codec_name: 'h264', codec_type: 'video', width: 1920, height: 1080, disposition: { default: 1 }, tags: {} },
      { index: 1, codec_name: 'aac', codec_type: 'audio', channels: 2, disposition: { default: 1 }, tags: { language: 'eng', title: 'Original' } },
      { index: 2, codec_name: 'ac3', codec_type: 'audio', channels: 6, disposition: { default: 0 }, tags: { language: 'rus', title: 'LostFilm' } },
    ],
    format: { format_name: container, duration: '3000' },
  });
  function runnerOf(json: unknown) {
    const calls: string[][] = [];
    const runner: Runner = {
      available: async () => ({ ffprobe: true, mkvmerge: true }),
      probe: async () => json,
      async mkvmerge(args) {
        calls.push(args);
        writeFileSync(args[1], 'пересобрано');
        return { code: 0, output: '' };
      },
    };
    return { runner, calls };
  }
  async function packSetup(files: string[]) {
    const s = setup();
    const studio = s.db.insert(studios).values({ name: 'LostFilm', kind: 'both', source: 'manual', createdAt: 1 }).returning().get();
    s.db.insert(subscriptions).values({ titleId: s.t.id, profile: { dubs: [{ kind: 'studio', studioId: studio.id, waitDays: 0 }], quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: null }, scope: { mode: 'all' }, wholeSeasonAfterFinale: false, replaceWithHigher: true, autoNextSeason: true }, subscribedAt: 1, updatedAt: 1 }).run();
    for (const n of [1, 2]) s.db.insert(episodes).values({ titleId: s.t.id, season: 1, number: n, name: `E${n}`, airDate: '2011-04-17', runtime: 55 }).run();
    const r = s.mk('GoT S01', {});
    s.files.set(r.id, torrent('GoT S01', files));
    const d = await startRelease(s.db, s.deps, r, [1, 2].map((number) => ({ season: 1, number })), 'pack', 'LostFilm', { dubPosition: 0 });
    return { ...s, d };
  }

  test('за проход — одна пересборка; уже импортированное не пересобирается снова', async () => {
    const s = await packSetup(['GoT.S01E01.mkv', 'GoT.S01E02.mkv']);
    s.finish(s.d.hash);
    const { runner, calls } = runnerOf(multiProbe());
    await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: HOUR, runner });
    expect(calls).toHaveLength(1);
    expect(s.db.select().from(episodeFiles).all()).toHaveLength(1);
    expect(s.db.select().from(downloads).get()!.state).toBe('completed');
    await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: 2 * HOUR, runner });
    expect(calls).toHaveLength(2);
    expect(s.db.select().from(episodeFiles).all()).toHaveLength(2);
    expect(s.db.select().from(downloads).get()!.state).toBe('imported');
    expect(calls[0][1]).toContain('/.dublyarr-tmp/');
  });

  test('внешние дорожки серии включаются к закачке и вшиваются', async () => {
    const s = await packSetup(['GoT.S01E01.mkv', 'GoT.S01E02.mkv', 'Rus Sound/LostFilm/GoT.S01E01.mka', 'Rus Sound/LostFilm/GoT.S01E02.mka']);
    expect(s.fq.torrents.get(s.d.hash)!.files.map((f) => f.priority)).toEqual([1, 1, 1, 1]);
    s.finish(s.d.hash);
    const { runner, calls } = runnerOf(multiProbe());
    await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: HOUR, runner });
    expect(calls[0].some((a) => a.endsWith('Rus Sound/LostFilm/GoT.S01E01.mka'))).toBe(true);
  });

  test('не mkv — кладётся как есть, без пересборки', async () => {
    const s = await packSetup(['GoT.S01E01.mp4', 'GoT.S01E02.mp4']);
    s.finish(s.d.hash);
    const { runner, calls } = runnerOf(multiProbe('mov,mp4,m4a,3gp,3g2,mj2'));
    await syncDownloads(s.db, { qbit: s.fq.qbit, paths: s.paths, now: HOUR, runner });
    expect(calls).toEqual([]);
    expect(s.db.select().from(episodeFiles).all().map((f) => f.path.endsWith('.mp4'))).toEqual([true, true]);
  });
});

test('временные файлы пересборки чистятся при старте', async () => {
  const media = mkdtempSync(path.join(tmpdir(), 'dy-tmp-'));
  mkdirSync(path.join(media, '.dublyarr-tmp'));
  writeFileSync(path.join(media, '.dublyarr-tmp', '.dy-1.tmp.mkv'), 'x');
  await cleanRemuxTmp(media);
  expect(readdirSync(path.join(media, '.dublyarr-tmp'))).toEqual([]);
});
