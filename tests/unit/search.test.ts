import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { testDb } from './helpers';
import { fakeTmdb } from './fake-tmdb';
import { syncTitle } from '@/lib/catalog';
import { seedStudios } from '@/lib/studios';
import { addSource } from '@/lib/sources';
import { syncTrackers } from '@/lib/trackers';
import { searchTitle, queriesFor } from '@/lib/search';
import { releases, sources } from '@/lib/db/schema';
import { decrypt } from '@/lib/crypto/secretbox';
import type { TmdbSeason, TmdbTvDetails } from '@/lib/tmdb/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const fx = <T>(n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8')) as T;
const xml = readFileSync('tests/fixtures/torznab/search-jackett.xml', 'utf8');
const indexers = readFileSync('tests/fixtures/torznab/indexers-jackett.xml', 'utf8');

async function setup() {
  const db = testDb();
  seedStudios(db);
  const { tmdb } = fakeTmdb({ details: { 1399: fx<TmdbTvDetails>('tv-1399') }, seasons: { '1399:1': fx<TmdbSeason>('tv-1399-season-1') } });
  const t = await syncTitle(db, tmdb, 1399, { now: 1 });
  return { db, t };
}

/** fetch по хосту: host → обработчик. */
const router = (routes: Record<string, (u: URL, init?: RequestInit) => Response | Promise<Response>>) =>
  ((input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const h = routes[u.host];
    if (!h) throw new TypeError('fetch failed');
    return Promise.resolve(h(u, init));
  }) as typeof fetch;
const ok = (u: URL) => new Response(u.searchParams.get('t') === 'indexers' ? indexers : xml);
const hang = (_u: URL, init?: RequestInit) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));

test('запросы по названиям: без дублей, не больше 4, аниме — латиница первой', async () => {
  const { t } = await setup();
  expect(queriesFor(t)).toEqual(['Игра престолов', 'Game of Thrones', 'Игра тронов', 'GoT']);
  const anime = { ...t, kind: 'anime' as const, nameRu: 'Атака титанов', nameOriginal: '進撃の巨人', altNames: ['Shingeki no Kyojin', 'Attack on Titan', 'атака титанов'] };
  expect(queriesFor(anime)).toEqual(['Shingeki no Kyojin', 'Attack on Titan', 'Атака титанов']);
});

test('одна раздача через два источника — одна запись от основного; разные качества — разные записи', async () => {
  const { db, t } = await setup();
  const a = addSource(db, { name: 'A', url: 'http://a/api', apiKey: 'KEY-A' });
  addSource(db, { name: 'B', url: 'http://b/api', apiKey: 'KEY-B' });
  const r = await searchTitle(db, t.id, { fetchImpl: router({ a: ok, b: ok }), now: 100 });
  expect(r.sources.map((s) => ({ name: s.name, ok: s.ok }))).toEqual([
    { name: 'A', ok: true },
    { name: 'B', ok: true },
  ]);
  const rows = db.select().from(releases).all();
  expect(rows).toHaveLength(4);
  expect(rows.every((x) => x.sourceId === a.id)).toBe(true);
  expect(rows.filter((x) => x.trackerName === 'RuTracker.org').map((x) => x.parsed.resolution!).sort((p, q) => p - q)).toEqual([720, 1080]);
});

test('основной источник упал — раздачи берутся из запасного', async () => {
  const { db, t } = await setup();
  const a = addSource(db, { name: 'A', url: 'http://a/api', apiKey: 'k' });
  const b = addSource(db, { name: 'B', url: 'http://b/api', apiKey: 'k' });
  syncTrackers(db, a.id, [{ id: 'rutracker', name: 'RuTracker.org', categories: [5000] }, { id: 'kinozal', name: 'Kinozal', categories: [5000] }, { id: 'lostfilm', name: 'LostFilm.tv', categories: [5000] }]);
  const r = await searchTitle(db, t.id, { fetchImpl: router({ a: () => new Response('', { status: 502 }), b: ok }), now: 100 });
  expect(r.sources.find((s) => s.name === 'A')).toMatchObject({ ok: false, error: 'HTTP 502' });
  expect(db.select().from(releases).all().every((x) => x.sourceId === b.id)).toBe(true);
  expect(db.select().from(releases).all()).toHaveLength(4);
});

test('зависший источник не держит поиск дольше таймаута', async () => {
  const { db, t } = await setup();
  addSource(db, { name: 'A', url: 'http://a/api', apiKey: 'k' });
  const c = addSource(db, { name: 'C', url: 'http://c/api', apiKey: 'k' });
  db.update(sources).set({ timeoutMs: 50 }).run();
  const started = Date.now();
  const r = await searchTitle(db, t.id, { fetchImpl: router({ a: ok, c: hang }), now: 100 });
  expect(Date.now() - started).toBeLessThan(2000);
  expect(r.sources.find((s) => s.sourceId === c.id)).toMatchObject({ ok: false, error: 'Нет ответа за 0,05 с' });
  expect(r.releases.length).toBe(4);
});

test('повторный поиск: дата первого появления не меняется, сиды обновляются; ссылка зашифрована', async () => {
  const { db, t } = await setup();
  addSource(db, { name: 'A', url: 'http://a/api', apiKey: 'k' });
  await searchTitle(db, t.id, { fetchImpl: router({ a: ok }), now: 100 });
  const more = xml.replace('name="seeders" value="120"', 'name="seeders" value="999"');
  await searchTitle(db, t.id, { fetchImpl: router({ a: () => new Response(more) }), now: 200 });
  const row = db.select().from(releases).all().find((x) => x.infohash === 'aaaa1111bbbb2222cccc3333dddd4444eeee5555')!;
  expect(row).toMatchObject({ firstSeenAt: 100, lastSeenAt: 200, seeders: 999 });
  expect(row.downloadEnc).not.toContain('SECRETKEY');
  expect(decrypt(row.downloadEnc!)).toContain('jackett_apikey=SECRETKEY');
  expect(db.select().from(releases).all()).toHaveLength(4);
});

test('разбор и совпадение сохраняются', async () => {
  const { db, t } = await setup();
  addSource(db, { name: 'A', url: 'http://a/api', apiKey: 'k' });
  const r = await searchTitle(db, t.id, { fetchImpl: router({ a: ok }), now: 100 });
  const lf = r.releases.find((x) => x.trackerName === 'LostFilm.tv')!;
  expect(lf.parsed).toMatchObject({ seasons: [1], episodes: { from: 3, to: 3 }, resolution: 1080 });
  expect(lf.parsed.dubs[0]).toMatchObject({ by: 'tracker' });
  expect(lf.match.level).toBe('match');
});

test('раздача сначала без infohash, потом с ним — обновляется, а не падает', async () => {
  const { db, t } = await setup();
  addSource(db, { name: 'A', url: 'http://a/api', apiKey: 'k' });
  const noHash = xml.replace(/<torznab:attr name="infohash" value="[^"]+" \/>/g, '');
  await searchTitle(db, t.id, { fetchImpl: router({ a: () => new Response(noHash) }), now: 100 });
  await expect(searchTitle(db, t.id, { fetchImpl: router({ a: ok }), now: 200 })).resolves.toBeDefined();
  const rows = db.select().from(releases).all();
  expect(rows).toHaveLength(4);
  expect(rows.find((x) => x.trackerName === 'LostFilm.tv')).toMatchObject({ infohash: 'ffff0000ffff0000ffff0000ffff0000ffff0000', firstSeenAt: 100 });
});
