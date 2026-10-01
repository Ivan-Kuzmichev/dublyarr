import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDb } from './helpers';
import { fakeQbit } from './fake-qbit';
import { bencode } from '@/lib/torrent-file';
import { deleteSeries } from '@/lib/delete-series';
import { deletions, downloads, episodeFiles, oldCopies, subscriptions, titles } from '@/lib/db/schema';
import type { Profile } from '@/lib/profile-core';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const b = (s: string) => Buffer.from(s);
const torrent = (name: string, files: string[], v = 1) =>
  bencode(new Map<string, unknown>([['info', new Map<string, unknown>([['name', b(name)], ['piece length', v], ['pieces', Buffer.alloc(20)], ['files', files.map((f) => new Map<string, unknown>([['length', 5], ['path', [b(f)]]]))]])]]));

async function setup() {
  const db = testDb();
  const root = mkdtempSync(path.join(tmpdir(), 'dy-del-'));
  const paths = { qbitDownloads: '/downloads', downloads: path.join(root, 'dl'), media: path.join(root, 'media') };
  const put = (p: string) => {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, 'x');
    return p;
  };
  const mk = (tmdbId: number, name: string) => db.insert(titles).values({ tmdbId, kind: 'series', nameRu: name, nameOriginal: name, originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const t = mk(1, 'Дэдлок');
  const other = mk(2, 'Другой');
  db.insert(subscriptions).values({ titleId: t.id, profile: {} as Profile, subscribedAt: 1, updatedAt: 1 }).run();
  for (const n of [1, 2]) {
    const rel = `Дэдлок (2023)/Season 01/E${n}.mkv`;
    put(path.join(paths.media, rel));
    db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: n, path: rel, size: 1000, method: 'copy', importedAt: 1 }).run();
  }
  put(path.join(paths.media, '.dublyarr-old/Дэдлок (2023)/Season 01/E1.mkv'));
  db.insert(oldCopies).values({ titleId: t.id, season: 1, number: 1, path: '.dublyarr-old/Дэдлок (2023)/Season 01/E1.mkv', size: 500, reason: 'x', createdAt: 1 }).run();
  const fq = fakeQbit();
  const mine = torrent('Pack', ['E1.mkv', 'E2.mkv']);
  const theirs = torrent('Pack', ['E1.mkv'], 2); // другой торрент в ту же папку, делит E1
  await fq.qbit.add(mine, { savePath: '/downloads/dublyarr', category: 'dublyarr', paused: false });
  await fq.qbit.add(theirs, { savePath: '/downloads/dublyarr', category: 'dublyarr', paused: false });
  const [h1, h2] = [...fq.torrents.keys()];
  db.insert(downloads).values({ hash: h1, titleId: t.id, season: 1, kind: 'pack', episodes: [], state: 'imported', name: 'Pack', size: 10, addedAt: 1 }).run();
  db.insert(downloads).values({ hash: h2, titleId: other.id, season: 1, kind: 'pack', episodes: [], state: 'downloading', name: 'Pack', size: 5, addedAt: 1 }).run();
  const shared = put(path.join(paths.downloads, 'dublyarr/Pack/E1.mkv'));
  const own = put(path.join(paths.downloads, 'dublyarr/Pack/E2.mkv'));
  return { db, t, fq, paths, shared, own, h1, h2 };
}

describe('удаление сериала', () => {
  test('только файлы: медиатека, старые копии, свой торрент и его файлы (кроме общих); подписка остаётся', async () => {
    const s = await setup();
    const r = await deleteSeries(s.db, { qbit: s.fq.qbit, paths: s.paths }, s.t.id, 'files', 5);
    expect(r).toMatchObject({ files: 3, torrents: 1 });
    expect(s.db.select().from(episodeFiles).all()).toEqual([]);
    expect(s.db.select().from(oldCopies).all()).toEqual([]);
    expect(existsSync(path.join(s.paths.media, 'Дэдлок (2023)'))).toBe(false);
    expect(s.fq.torrents.has(s.h1)).toBe(false);
    expect(s.fq.torrents.has(s.h2)).toBe(true);
    expect(existsSync(s.own)).toBe(false);
    expect(existsSync(s.shared)).toBe(true);
    expect(s.db.select().from(subscriptions).all()).toHaveLength(1);
    expect(s.db.select().from(deletions).get()).toMatchObject({ label: 'Дэдлок · все файлы', why: 'удалено вручную' });
  });
  test('только отписаться — файлы на месте; всё — и то и другое', async () => {
    const a = await setup();
    await deleteSeries(a.db, { qbit: a.fq.qbit, paths: a.paths }, a.t.id, 'sub');
    expect(a.db.select().from(subscriptions).all()).toEqual([]);
    expect(a.db.select().from(episodeFiles).all()).toHaveLength(2);
    const b2 = await setup();
    await deleteSeries(b2.db, { qbit: b2.fq.qbit, paths: b2.paths }, b2.t.id, 'all');
    expect(b2.db.select().from(subscriptions).all()).toEqual([]);
    expect(b2.db.select().from(episodeFiles).all()).toEqual([]);
  });
  test('путь вне медиатеки не удаляется; без qBittorrent торренты не трогаются', async () => {
    const s = await setup();
    const { eq } = await import('drizzle-orm');
    s.db.update(episodeFiles).set({ path: '../escape.mkv' }).where(eq(episodeFiles.number, 1)).run();
    const r = await deleteSeries(s.db, { qbit: null, paths: s.paths }, s.t.id, 'files');
    expect(r.torrents).toBe(0);
    expect(s.db.select().from(episodeFiles).all().map((f) => f.path)).toEqual(['../escape.mkv']);
    expect(existsSync(s.own)).toBe(true);
  });
});

test('сбой qBittorrent не обрывает удаление: подписка снята, история записана, загрузки сериала больше не импортируются', async () => {
  const s = await setup();
  const qbit = { ...s.fq.qbit, list: async () => { throw new Error('qBittorrent не отвечает'); } };
  await deleteSeries(s.db, { qbit, paths: s.paths }, s.t.id, 'all');
  expect(s.db.select().from(subscriptions).all()).toEqual([]);
  expect(s.db.select().from(deletions).all()).toHaveLength(1);
  const { eq } = await import('drizzle-orm');
  expect(s.db.select().from(downloads).where(eq(downloads.titleId, s.t.id)).get()!.state).toBe('removed');
  expect(existsSync(s.own)).toBe(true); // без списка файлов клиента файлы загрузок не трогаем
});

test('удалённые вручную серии помечены — поиск их не вернёт', async () => {
  const s = await setup();
  await deleteSeries(s.db, { qbit: s.fq.qbit, paths: s.paths }, s.t.id, 'files');
  const { retiredEpisodes } = await import('@/lib/db/schema');
  expect(s.db.select().from(retiredEpisodes).all().map((r) => r.number).sort()).toEqual([1, 2]);
});
