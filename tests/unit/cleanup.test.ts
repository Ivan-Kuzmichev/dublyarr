import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDb } from './helpers';
import { fakeQbit } from './fake-qbit';
import { bencode } from '@/lib/torrent-file';
import { startRelease } from '@/lib/downloads';
import { cleanupConfirmed, cleanupPlan, DEFAULT_CLEANUP, parseCleanupForm, runCleanup, type CleanupSettings } from '@/lib/cleanup';
import { getSetting } from '@/lib/settings';
import { eq } from 'drizzle-orm';
import { downloads, releases, sources, titles, type Release } from '@/lib/db/schema';
import type { ParsedRelease } from '@/lib/parse/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const DAY = 86_400_000;
const NOW = 100 * DAY;
const b = (s: string) => Buffer.from(s);
function torrent(name: string, files: string[] | null, v = 1) {
  const info = new Map<string, unknown>([['name', b(name)], ['piece length', v], ['pieces', Buffer.alloc(20)]]);
  if (files) info.set('files', files.map((f) => new Map<string, unknown>([['length', 5], ['path', [b(f)]]])));
  else info.set('length', 5);
  return bencode(new Map<string, unknown>([['info', info]]));
}
const parsed: ParsedRelease = { base: 'x', names: [], year: null, seasons: [1], episodes: null, totalInSeason: null, absolute: false, pack: false, resolution: 1080, source: null, hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false };

function setup() {
  const db = testDb();
  const root = mkdtempSync(path.join(tmpdir(), 'dy-clean-'));
  const local = path.join(root, 'dl');
  mkdirSync(path.join(local, 'dublyarr'), { recursive: true });
  const paths = { qbitDownloads: '/downloads', downloads: local, media: path.join(root, 'media') };
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'Сериал', nameOriginal: 'S', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const fq = fakeQbit();
  const files = new Map<number, Buffer>();
  const deps = { qbit: fq.qbit, fetchTorrent: async (r: Release) => files.get(r.id)!, paths: { qbitDownloads: '/downloads' }, now: 1 };
  const disk = (rel: string, ageDays = 5) => {
    const p = path.join(local, 'dublyarr', rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, 'video');
    const t = (NOW - ageDays * DAY) / 1000;
    utimesSync(p, t, t);
    return p;
  };
  let n = 0;
  const start = async (tor: Buffer, kind: 'episode' | 'pack' = 'episode') => {
    const r = db.insert(releases).values({ titleId: t.id, sourceId: s.id, trackerName: 'X', title: `r${n++}`, size: 5, firstSeenAt: 1, lastSeenAt: 1, parsed: { ...parsed, pack: kind === 'pack' }, match: { score: 1, level: 'match', reasons: [] } }).returning().get();
    files.set(r.id, tor);
    return startRelease(db, deps, r, [{ season: 1, number: 1 }], kind, null);
  };
  const plan = (o: Partial<CleanupSettings> = {}) => cleanupPlan(db, fq.qbit, paths, { ...DEFAULT_CLEANUP, ...o }, NOW);
  return { db, fq, disk, start, plan, local };
}

describe('план уборки', () => {
  test('сразу после импорта / после раздачи по дням и рейтингу / никогда', async () => {
    const { db, fq, disk, start, plan } = setup();
    const d = await start(torrent('S.S01E01.mkv', null));
    const file = disk('S.S01E01.mkv');
    expect(await plan({ remove: 'import' })).toEqual([]); // ещё качается
    db.update(downloads).set({ state: 'imported' }).run();
    expect(await plan({ remove: 'import' })).toEqual([expect.objectContaining({ kind: 'torrent', downloadId: d.id, reason: 'Убран после импорта', files: [file], size: 5, inClient: true })]);
    const tor = fq.torrents.get(d.hash)!;
    Object.assign(tor, { completion_on: (NOW - 2 * DAY) / 1000, ratio: 1 });
    expect(await plan({ remove: 'seeded' })).toEqual([]);
    tor.completion_on = (NOW - 4 * DAY) / 1000;
    expect((await plan({ remove: 'seeded' }))[0]).toMatchObject({ reason: 'Раздача 4 дн' });
    Object.assign(tor, { completion_on: (NOW - DAY) / 1000, ratio: 2.5 });
    expect((await plan({ remove: 'seeded' }))[0]).toMatchObject({ reason: 'Рейтинг 2,5' });
    expect(await plan({ remove: 'never' })).toEqual([]);
    expect((await plan({ remove: 'import', deleteFiles: false }))[0]).toMatchObject({ files: [], size: 0 });
  });

  test('заменённая: файлы, кроме общих с живым торрентом', async () => {
    const { db, fq, disk, start, plan } = setup();
    const old = await start(torrent('S', ['S.S01E01.mkv', 'S.S01E02.mkv']), 'pack');
    db.update(downloads).set({ state: 'replaced' }).run();
    fq.torrents.delete(old.hash); // старую версию 2a уже убрала из клиента
    const shared = disk('S/S.S01E01.mkv');
    const gone = disk('S/S.S01E02.mkv');
    // новая версия топика в клиенте использует E01
    await start(torrent('S', ['S.S01E01.mkv'], 2), 'pack');
    const items = await plan();
    expect(items).toEqual([expect.objectContaining({ kind: 'torrent', reason: 'Заменённая раздача', files: [gone], inClient: false })]);
    expect(items[0].kind === 'torrent' && items[0].files).not.toContain(shared);
    expect(await plan({ replaced: false })).toEqual([]);
  });

  test('файлы вне папки dublyarr не удаляются', async () => {
    const { db, fq, start, plan } = setup();
    const d = await start(torrent('S.S01E01.mkv', null));
    db.update(downloads).set({ state: 'imported' }).run();
    fq.torrents.get(d.hash)!.save_path = '/other';
    expect(await plan({ remove: 'import' })).toEqual([expect.objectContaining({ files: [], inClient: true })]);
  });

  test('брошенные файлы: старше суток и ничьи', async () => {
    const { disk, start, plan } = setup();
    await start(torrent('S.S01E01.mkv', null));
    disk('S.S01E01.mkv'); // файл живого торрента
    const old = disk('junk/old.mkv', 2);
    disk('junk/fresh.mkv', 0);
    expect(await plan()).toEqual([expect.objectContaining({ kind: 'orphan', path: old, size: 5 })]);
    expect(await plan({ orphans: false })).toEqual([]);
  });
});

test('разбор формы уборки', () => {
  const f = (o: Record<string, string>) => {
    const x = new FormData();
    for (const [k, v] of Object.entries(o)) x.set(k, v);
    return x;
  };
  expect(parseCleanupForm(f({ remove: 'seeded', seedDays: '3', seedRatio: '1,5', deleteFiles: 'on', orphans: 'on' }))).toEqual({ remove: 'seeded', seedDays: 3, seedRatio: 1.5, deleteFiles: true, replaced: false, orphans: true });
  expect(parseCleanupForm(f({ remove: 'x', seedDays: '3', seedRatio: '1' }))).toEqual({ error: 'Неизвестный режим уборки' });
  expect(parseCleanupForm(f({ remove: 'seeded', seedDays: '-1', seedRatio: '1' }))).toEqual({ error: 'Дни раздачи — от 0 до 365' });
  expect(parseCleanupForm(f({ remove: 'seeded', seedDays: '3', seedRatio: '200' }))).toEqual({ error: 'Рейтинг — от 0 до 100' });
});

describe('выполнение уборки', () => {
  const ready = async () => {
    const s = setup();
    const d = await s.start(torrent('S.S01E01.mkv', null));
    const file = s.disk('S.S01E01.mkv');
    s.db.update(downloads).set({ state: 'imported' }).run();
    const orphan = s.disk('junk/old.mkv', 2);
    return { ...s, d, file, orphan };
  };
  const run = (s: Awaited<ReturnType<typeof ready>>, o: Partial<CleanupSettings> = {}, keys?: string[]) =>
    runCleanup(s.db, s.fq.qbit, { qbitDownloads: '/downloads', downloads: s.local, media: '/m' }, { ...DEFAULT_CLEANUP, remove: 'import', ...o }, NOW, keys ? { confirmKeys: keys } : undefined);

  test('до подтверждения ничего не удаляется и торрент на месте', async () => {
    const s = await ready();
    expect(await run(s)).toEqual({ removed: 0, deletedFiles: 0, freed: 0, pending: 2 });
    expect(existsSync(s.file)).toBe(true);
    expect(existsSync(s.orphan)).toBe(true);
    expect(s.fq.torrents.has(s.d.hash)).toBe(true);
    expect(getSetting(s.db, 'cleanup.pending')).toEqual({ count: 2, size: 10 });
  });

  test('подтверждение отмеченного: торрент убран без файлов клиентом, файлы удалены нами, правило включено', async () => {
    const s = await ready();
    expect(await run(s, {}, [`t:${s.d.id}`])).toMatchObject({ removed: 1, deletedFiles: 1, freed: 5 });
    expect(s.fq.torrents.has(s.d.hash)).toBe(false);
    expect(existsSync(s.file)).toBe(false);
    expect(existsSync(s.orphan)).toBe(true); // не отмечен
    expect(s.db.select().from(downloads).get()).toMatchObject({ state: 'removed', note: 'Убран после импорта' });
    expect(cleanupConfirmed(s.db)).toEqual({ files: true, orphans: false });
    // дальше — сам; брошенные ждут своего подтверждения
    const d2 = await s.start(torrent('S.S01E02.mkv', null));
    const f2 = s.disk('S.S01E02.mkv');
    s.db.update(downloads).set({ state: 'imported' }).where(eq(downloads.id, d2.id)).run();
    expect(await run(s)).toMatchObject({ removed: 1, deletedFiles: 1, pending: 1 });
    expect(existsSync(f2)).toBe(false);
  });

  test('удаление файлов выключено — торрент убирается сразу, файлы на месте', async () => {
    const s = await ready();
    expect(await run(s, { deleteFiles: false })).toMatchObject({ removed: 1, deletedFiles: 0, pending: 0 });
    expect(s.fq.torrents.has(s.d.hash)).toBe(false);
    expect(existsSync(s.file)).toBe(true);
    expect(existsSync(s.orphan)).toBe(true);
  });

  test('брошенные — после своего подтверждения; пустые папки убираются', async () => {
    const s = await ready();
    await run(s, { remove: 'never' }, [`o:junk/old.mkv`]);
    expect(existsSync(s.orphan)).toBe(false);
    expect(existsSync(path.dirname(s.orphan))).toBe(false);
    expect(cleanupConfirmed(s.db)).toEqual({ files: false, orphans: true });
  });
});
