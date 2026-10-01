import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { fakeQbit } from './fake-qbit';
import { bencode, parseTorrent } from '@/lib/torrent-file';
import { QbitError } from '@/lib/qbit';
import { startRelease, enableFiles, activeDownloads, fetchTorrentFile, DownloadError, syncDownloads } from '@/lib/downloads';
import { downloads, releases, sources, titles, type Release } from '@/lib/db/schema';
import { encrypt } from '@/lib/crypto/secretbox';
import type { ParsedRelease } from '@/lib/parse/types';
import { Writable } from 'node:stream';
import { setLogDestination, applyLogSettings } from '@/lib/log';

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

function setup() {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const mk = (title: string, p: Partial<ParsedRelease>) =>
    db.insert(releases).values({ titleId: t.id, sourceId: s.id, trackerName: 'X', title, size: 100, firstSeenAt: 1, lastSeenAt: 1, parsed: parsed(p), match: { score: 1, level: 'match', reasons: [] }, downloadEnc: encrypt(`http://j/dl/${title}?apikey=K`) }).returning().get();
  const fq = fakeQbit();
  const files = new Map<number, Buffer>();
  const deps = { qbit: fq.qbit, fetchTorrent: async (r: Release) => files.get(r.id)!, paths: { qbitDownloads: '/downloads' }, now: 10 };
  return { db, t, mk, fq, files, deps };
}

test('отдельная серия: добавлена и запущена, запись «качается»', async () => {
  const { db, mk, fq, files, deps } = setup();
  const r = mk('A S01E03', { pack: false, episodes: { from: 3, to: 3 } });
  files.set(r.id, torrent('A.S01E03.mkv', null));
  const d = await startRelease(db, deps, r, [{ season: 1, number: 3 }], 'episode', 'LostFilm');
  expect(d).toMatchObject({ state: 'downloading', kind: 'episode', season: 1, studioLabel: 'LostFilm', resolution: 1080, episodes: [{ season: 1, number: 3 }] });
  expect(fq.calls).toEqual(['category', 'add', 'start']);
  expect([...fq.torrents.values()][0]).toMatchObject({ save_path: '/downloads/dublyarr', category: 'dublyarr', paused: false });
});

test('пак: нужные файлы — 1, остальные — 0', async () => {
  const { db, mk, fq, files, deps } = setup();
  const r = mk('A S01', {});
  files.set(r.id, torrent('A S01', ['A.S01E01.mkv', 'A.S01E02.mkv', 'A.S01E03.mkv']));
  const d = await startRelease(db, deps, r, [{ season: 1, number: 2 }], 'pack', 'LostFilm');
  expect(fq.torrents.get(d.hash)!.files.map((f) => f.priority)).toEqual([0, 1, 0]);
  expect(d.files!.map((f) => f.priority)).toEqual([0, 1, 0]);
  expect(activeDownloads(db, d.titleId)).toEqual([{ id: d.id, kind: 'pack', season: 1, episodes: [{ season: 1, number: 2 }], files: d.files, state: 'downloading' }]);
});

test('та же раздача второй раз — одна загрузка, файл включается', async () => {
  const { db, mk, fq, files, deps } = setup();
  const r = mk('A S01', {});
  files.set(r.id, torrent('A S01', ['A.S01E01.mkv', 'A.S01E02.mkv', 'A.S01E03.mkv']));
  const d1 = await startRelease(db, deps, r, [{ season: 1, number: 2 }], 'pack', 'LostFilm');
  const d2 = await startRelease(db, deps, r, [{ season: 1, number: 3 }], 'pack', 'LostFilm');
  expect(d2.id).toBe(d1.id);
  expect(db.select().from(downloads).all()).toHaveLength(1);
  expect(d2.episodes).toEqual([{ season: 1, number: 2 }, { season: 1, number: 3 }]);
  expect(fq.torrents.get(d1.hash)!.files.map((f) => f.priority)).toEqual([0, 1, 1]);
  expect(fq.calls.filter((c) => c === 'add')).toHaveLength(1);
});

test('enableFiles включает файл в качающемся паке', async () => {
  const { db, mk, fq, files, deps } = setup();
  const r = mk('A S01', {});
  files.set(r.id, torrent('A S01', ['A.S01E01.mkv', 'A.S01E02.mkv']));
  const d = await startRelease(db, deps, r, [{ season: 1, number: 1 }], 'pack', 'X');
  await enableFiles(db, deps, d.id, [{ season: 1, number: 2 }]);
  expect(fq.torrents.get(d.hash)!.files.map((f) => f.priority)).toEqual([1, 1]);
  expect(db.select().from(downloads).get()!.episodes).toEqual([{ season: 1, number: 1 }, { season: 1, number: 2 }]);
});

test('в паке нет файла серии — ошибка, торрент убран из клиента', async () => {
  const { db, mk, fq, files, deps } = setup();
  const r = mk('A S01', {});
  files.set(r.id, torrent('A S01', ['A.S01E01.mkv', 'A.S01E02.mkv']));
  const d = await startRelease(db, deps, r, [{ season: 1, number: 5 }], 'pack', 'X');
  expect(d).toMatchObject({ state: 'error', lastError: 'В раздаче нет файла S01E05' });
  expect(fq.torrents.size).toBe(0);
  expect(activeDownloads(db, d.titleId)).toEqual([]);
});

test('получение торрента: ссылка, иначе magnet, иначе ошибка', async () => {
  const { mk } = setup();
  const r = mk('A S01E01', {});
  const ok = (async (u: RequestInfo | URL) => {
    expect(String(u)).toBe('http://j/dl/A S01E01?apikey=K');
    return new Response(new Uint8Array(torrent('x', null)));
  }) as typeof fetch;
  expect(Buffer.isBuffer(await fetchTorrentFile(r, ok))).toBe(true);
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  expect(await fetchTorrentFile({ ...r, magnet: 'magnet:?xt=urn:btih:aa' } as Release, down)).toEqual({ magnet: 'magnet:?xt=urn:btih:aa' });
  await expect(fetchTorrentFile(r, down)).rejects.toBeInstanceOf(DownloadError);
  await expect(fetchTorrentFile(r, (async () => new Response('<html>')) as typeof fetch)).rejects.toThrow('Не удалось получить торрент');
});

test('раздача уже импортирована и раздаётся — та же запись, включается новый файл, без повторного add', async () => {
  const { db, mk, fq, files, deps } = setup();
  const r = mk('A S01', {});
  files.set(r.id, torrent('A S01', ['A.S01E01.mkv', 'A.S01E02.mkv', 'A.S01E03.mkv']));
  const d = await startRelease(db, deps, r, [{ season: 1, number: 1 }], 'pack', 'LostFilm');
  db.update(downloads).set({ state: 'imported', importedAt: 5 }).run();
  fq.calls.length = 0;
  const again = await startRelease(db, deps, r, [{ season: 1, number: 3 }], 'pack', 'LostFilm');
  expect(again.id).toBe(d.id);
  expect(again).toMatchObject({ state: 'downloading', episodes: [{ season: 1, number: 3 }] });
  expect(fq.calls).not.toContain('add');
  expect(fq.torrents.get(d.hash)!.files.map((f) => f.priority)).toEqual([1, 0, 1]);
});

test('magnet-пак: ждём метаданные на паузе, файлы выбираются при синхронизации', async () => {
  const { db, mk, fq, deps } = setup();
  const r = mk('A S01', {});
  const hash = 'a'.repeat(40);
  const d = await startRelease(db, { ...deps, fetchTorrent: async () => ({ magnet: `magnet:?xt=urn:btih:${hash}` }) }, r, [{ season: 1, number: 2 }], 'pack', null);
  expect(d.state).toBe('adding');
  expect(fq.calls).not.toContain('start');
  expect(fq.torrents.get(hash)!.paused).toBe(true);
  // метаданные пришли
  fq.torrents.get(hash)!.files = ['A.S01E01.mkv', 'A.S01E02.mkv', 'A.S01E03.mkv'].map((name, index) => ({ index, name, size: 100, progress: 0, priority: 1 }));
  await syncDownloads(db, { qbit: fq.qbit, paths: { qbitDownloads: '/downloads', downloads: '/tmp/x', media: '/tmp/y' }, now: 20 });
  expect(fq.torrents.get(hash)!.files.map((f) => f.priority)).toEqual([0, 1, 0]);
  expect(fq.torrents.get(hash)!.paused).toBe(false);
  expect(db.select().from(downloads).get()).toMatchObject({ state: 'downloading', episodes: [{ season: 1, number: 2 }] });
});

test('гонка: торрент уже добавлен другим вызовом — отказ add не мешает', async () => {
  const { db, mk, fq, files, deps } = setup();
  const r = mk('A S01E03', { pack: false, episodes: { from: 3, to: 3 } });
  const t = torrent('A.S01E03.mkv', null);
  files.set(r.id, t);
  await fq.qbit.add(t, { savePath: '/downloads/dublyarr', category: 'dublyarr', paused: true });
  const qbit = { ...fq.qbit, add: async () => { throw new QbitError('qBittorrent не принял торрент: Fails.', 'http'); } };
  const d = await startRelease(db, { ...deps, qbit }, r, [{ season: 1, number: 3 }], 'episode', null);
  expect(d.state).toBe('downloading');
  expect(db.select().from(downloads).all()).toHaveLength(1);
});

test('гонка: запись с тем же хэшем появилась между проверкой и вставкой — дополняем её', async () => {
  const { db, t, mk, fq, files, deps } = setup();
  const r = mk('A S01', {});
  const tor = torrent('A S01', ['A.S01E01.mkv', 'A.S01E02.mkv']);
  files.set(r.id, tor);
  const hash = parseTorrent(tor).infohash;
  const qbit = {
    ...fq.qbit,
    add: async (x: Buffer | { magnet: string }, o: { savePath: string; category: string; paused: boolean }) => {
      await fq.qbit.add(x, o);
      db.insert(downloads).values({ hash, titleId: t.id, season: 1, kind: 'pack', episodes: [{ season: 1, number: 1 }], files: fq.torrents.get(hash)!.files.map((f) => ({ ...f, priority: f.index === 0 ? 1 : 0 })), state: 'downloading', name: 'A S01', size: 1, addedAt: 1 }).run();
    },
  };
  const d = await startRelease(db, { ...deps, qbit }, r, [{ season: 1, number: 2 }], 'pack', null);
  expect(db.select().from(downloads).all()).toHaveLength(1);
  expect(d.episodes).toEqual([{ season: 1, number: 1 }, { season: 1, number: 2 }]);
});

test('смена состояния загрузки пишется в журнал (downloads, info)', async () => {
  const lines: Record<string, unknown>[] = [];
  setLogDestination(
    new Writable({
      write(c, _e, cb) {
        for (const l of String(c).trim().split('\n')) lines.push(JSON.parse(l));
        cb();
      },
    }),
  );
  applyLogSettings({ level: 'info', areas: {} });
  const { db, mk, files, deps } = setup();
  const r = mk('A S01E03', { pack: false, episodes: { from: 3, to: 3 } });
  files.set(r.id, torrent('A.S01E03.mkv', null));
  await startRelease(db, deps, r, [{ season: 1, number: 3 }], 'episode', 'LostFilm');
  expect(lines.find((l) => l.area === 'downloads' && l.msg === 'state' && l.to === 'downloading')).toMatchObject({ from: 'adding', to: 'downloading' });
});
