import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers';
import { fakeQbit } from './fake-qbit';
import { bencode, parseTorrent } from '@/lib/torrent-file';
import { startRelease, switchTorrent, topicDownload } from '@/lib/downloads';
import { downloads, episodeFiles, releases, sources, titles, type Release } from '@/lib/db/schema';
import type { ParsedRelease } from '@/lib/parse/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

const b = (s: string) => Buffer.from(s);
/** Версия топика: те же имя и папка, другой хэш. */
function torrent(files: string[], version = 1) {
  const info = new Map<string, unknown>([['name', b('A S01')], ['piece length', version], ['pieces', Buffer.alloc(20)]]);
  info.set('files', files.map((f) => new Map<string, unknown>([['length', 100], ['path', [b(f)]]])));
  return bencode(new Map<string, unknown>([['info', info]]));
}
const parsed = (o: Partial<ParsedRelease>): ParsedRelease => ({
  base: 'x', names: [], year: null, seasons: [1], episodes: null, totalInSeason: null, absolute: false, pack: true,
  resolution: 1080, source: 'webdl', hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false, ...o,
});
const ep = (number: number) => ({ season: 1, number });
const v1 = torrent(['A.S01E01.mkv', 'A.S01E02.mkv']);
const v2 = torrent(['A.S01E01.mkv', 'A.S01E02.mkv', 'A.S01E03.mkv'], 2);

async function setup(want = [ep(1), ep(2)]) {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const mk = (title: string) =>
    db.insert(releases).values({ titleId: t.id, sourceId: s.id, trackerName: 'X', title, size: 100, firstSeenAt: 1, lastSeenAt: 1, parsed: parsed({}), match: { score: 1, level: 'match', reasons: [] }, detailsUrl: 'https://rutracker.org/forum/viewtopic.php?t=1' }).returning().get();
  const fq = fakeQbit();
  const files = new Map<number, Buffer>();
  const deps = { qbit: fq.qbit, fetchTorrent: async (r: Release) => files.get(r.id)!, paths: { qbitDownloads: '/downloads' }, now: 10 };
  const r = mk('A S01 1-2 из 8');
  files.set(r.id, v1);
  const old = await startRelease(db, deps, r, want, 'pack', 'LostFilm');
  return { db, t, mk, fq, files, deps, r, old };
}

test('топик обновился: новый торрент в той же папке, только новая серия, старый убран', async () => {
  const { db, fq, deps, old } = await setup();
  db.update(downloads).set({ state: 'imported' }).run();
  const res = await switchTorrent(db, deps, db.select().from(downloads).get()!, v2, [ep(3)]);
  expect(res).toMatchObject({ switched: true, added: [ep(3)] });
  const hash = parseTorrent(v2).infohash;
  expect(fq.torrents.get(hash)).toMatchObject({ save_path: '/downloads/dublyarr', paused: false });
  expect(fq.torrents.get(hash)!.files.map((f) => f.priority)).toEqual([0, 0, 1]);
  expect(fq.torrents.has(old.hash)).toBe(false);
  const fresh = db.select().from(downloads).where(eq(downloads.hash, hash)).get()!;
  expect(fresh).toMatchObject({ kind: 'pack', state: 'downloading', episodes: [ep(3)], releaseId: old.releaseId, studioLabel: 'LostFilm' });
  expect(db.select().from(downloads).where(eq(downloads.id, old.id)).get()).toMatchObject({ state: 'replaced', replacedById: fresh.id, note: 'Обновлена: +серия 3' });
});

test('недокачанные серии старой версии переезжают в новую', async () => {
  const { db, t, deps, old } = await setup();
  db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: 1, path: 'A/E1.mkv', size: 1, downloadId: old.id, method: 'hardlink', importedAt: 5 }).run();
  const res = await switchTorrent(db, deps, old, v2, [ep(3)]);
  expect(res.switched && res.download.episodes).toEqual([ep(2), ep(3)]);
});

test('тот же хэш — ничего; нужных файлов нет — клиент не тронут', async () => {
  const { db, fq, deps, old } = await setup();
  expect(await switchTorrent(db, deps, old, v1, [ep(3)])).toEqual({ switched: false, reason: 'same-hash' });
  fq.calls.length = 0;
  const other = torrent(['A.S02E01.mkv', 'A.S02E02.mkv'], 3);
  db.update(downloads).set({ state: 'imported' }).run();
  expect(await switchTorrent(db, deps, db.select().from(downloads).get()!, other, [ep(3)])).toEqual({ switched: false, reason: 'no-new-episodes' });
  expect(fq.calls).toEqual([]);
  expect(fq.torrents.has(old.hash)).toBe(true);
  expect(db.select().from(downloads).all()).toHaveLength(1);
});

test('старый торрент уже убран руками — всё равно переключаемся', async () => {
  const { db, fq, deps, old } = await setup();
  fq.torrents.delete(old.hash);
  const qbit = { ...fq.qbit, remove: async () => { throw new Error('нет такого'); } };
  const res = await switchTorrent(db, { ...deps, qbit }, old, v2, [ep(3)]);
  expect(res.switched).toBe(true);
  expect(db.select().from(downloads).where(eq(downloads.id, old.id)).get()!.state).toBe('replaced');
});

test('startRelease: другая раздача того же топика — смена версии, а не второй торрент', async () => {
  const { db, mk, fq, files, deps, old } = await setup();
  db.update(downloads).set({ state: 'imported' }).run();
  const r2 = mk('A S01 1-3 из 8');
  files.set(r2.id, v2);
  expect(topicDownload(db, r2, 1)?.id).toBe(old.id);
  expect(topicDownload(db, r2, 2)).toBeUndefined();
  const d = await startRelease(db, deps, r2, [ep(3)], 'pack', 'LostFilm');
  expect(d.episodes).toEqual([ep(3)]);
  expect(fq.torrents.size).toBe(1);
  expect(db.select().from(downloads).where(eq(downloads.id, old.id)).get()!.state).toBe('replaced');
});

test('топик переделан под другой сезон с файлами «01.mkv» — не переключаемся', async () => {
  const { db, deps, old } = await setup();
  const s2 = (() => {
    const info = new Map<string, unknown>([['name', b('A Season 2')], ['piece length', 9], ['pieces', Buffer.alloc(20)]]);
    info.set('files', ['01.mkv', '02.mkv', '03.mkv'].map((f) => new Map<string, unknown>([['length', 100], ['path', [b('Season 2'), b(f)]]])));
    return bencode(new Map<string, unknown>([['info', info]]));
  })();
  expect(await switchTorrent(db, deps, old, s2, [ep(3)])).toEqual({ switched: false, reason: 'no-new-episodes' });
  const one = (() => {
    const info = new Map<string, unknown>([['name', b('A.mkv')], ['piece length', 7], ['pieces', Buffer.alloc(20)], ['length', 100]]);
    return bencode(new Map<string, unknown>([['info', info]]));
  })();
  db.update(downloads).set({ state: 'imported' }).run();
  expect(await switchTorrent(db, deps, db.select().from(downloads).get()!, one, [ep(3)])).toEqual({ switched: false, reason: 'no-new-episodes' });
});

test('нужна серия другого сезона — обычное добавление, пак первого сезона не трогаем', async () => {
  const { db, mk, fq, files, deps, old } = await setup();
  db.update(downloads).set({ state: 'imported' }).run();
  const r2 = mk('A S01-02');
  const info = new Map<string, unknown>([['name', b('A S02')], ['piece length', 5], ['pieces', Buffer.alloc(20)]]);
  info.set('files', ['A.S02E01.mkv', 'A.S02E02.mkv'].map((f) => new Map<string, unknown>([['length', 100], ['path', [b(f)]]])));
  files.set(r2.id, bencode(new Map<string, unknown>([['info', info]])));
  const d = await startRelease(db, deps, r2, [{ season: 2, number: 1 }], 'pack', null);
  expect(d).toMatchObject({ season: 2, state: 'downloading', episodes: [{ season: 2, number: 1 }] });
  expect(db.select().from(downloads).where(eq(downloads.id, old.id)).get()!.state).toBe('imported');
  expect(fq.torrents.size).toBe(2);
});

test('сбой после добавления — новый торрент убран, записи нет; следующая попытка проходит', async () => {
  const { db, fq, deps, old } = await setup();
  const qbit = { ...fq.qbit, setFilePriority: async () => { throw new Error('qBittorrent не отвечает'); } };
  await expect(switchTorrent(db, { ...deps, qbit }, old, v2, [ep(3)])).rejects.toThrow('qBittorrent не отвечает');
  expect(fq.torrents.has(parseTorrent(v2).infohash)).toBe(false);
  expect(db.select().from(downloads).all()).toHaveLength(1);
  expect(db.select().from(downloads).get()!.state).toBe('downloading');
  expect((await switchTorrent(db, deps, old, v2, [ep(3)])).switched).toBe(true);
});

test('новая версия уже в клиенте без записи (прерванная смена) — не добавляем повторно', async () => {
  const { db, fq, deps, old } = await setup();
  await fq.qbit.add(v2, { savePath: '/downloads/dublyarr', category: 'dublyarr', paused: true });
  fq.calls.length = 0;
  const res = await switchTorrent(db, deps, old, v2, [ep(3)]);
  expect(res.switched).toBe(true);
  expect(fq.calls).not.toContain('add');
});

test('новая версия топика в qBittorrent 5 появляется не сразу — ждём, выбор файлов не теряется', async () => {
  const { db, deps } = await setup();
  db.update(downloads).set({ state: 'imported' }).run();
  const late = fakeQbit({ lateAdd: 3 });
  const res = await switchTorrent(db, { ...deps, qbit: late.qbit, sleep: async () => undefined }, db.select().from(downloads).get()!, v2, [ep(3)]);
  expect(res).toMatchObject({ switched: true });
  expect(late.torrents.get(parseTorrent(v2).infohash)!.files.map((f) => f.priority)).toEqual([0, 0, 1]);
});
