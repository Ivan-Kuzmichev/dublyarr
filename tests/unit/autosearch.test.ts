import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { testDb } from './helpers';
import { fakeTmdb } from './fake-tmdb';
import { fakeQbit } from './fake-qbit';
import { syncTitle } from '@/lib/catalog';
import { seedStudios, findStudioByAlias } from '@/lib/studios';
import { addSource } from '@/lib/sources';
import { builtinProfile, type Profile } from '@/lib/profile';
import { subscribe } from '@/lib/subscriptions';
import { searchSubscription, searchAll } from '@/lib/autosearch';
import { bencode } from '@/lib/torrent-file';
import { downloads, wantedState, episodeFiles, episodes as episodesT, type Release } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { TmdbSeason, TmdbTvDetails } from '@/lib/tmdb/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const fx = <T>(n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8')) as T;
const xml = readFileSync('tests/fixtures/torznab/search-jackett.xml', 'utf8');
const b = (s: string) => Buffer.from(s);
const pack = (name: string) =>
  bencode(
    new Map<string, unknown>([
      ['info', new Map<string, unknown>([['name', b(name)], ['piece length', 1], ['pieces', Buffer.alloc(20)], ['files', Array.from({ length: 10 }, (_, i) => new Map<string, unknown>([['length', 100], ['path', [b(`Game.of.Thrones.S01E${String(i + 1).padStart(2, '0')}.mkv`)]]]))]])],
    ]),
  );
const single = (name: string) => bencode(new Map<string, unknown>([['info', new Map<string, unknown>([['name', b(name)], ['length', 100], ['piece length', 1], ['pieces', Buffer.alloc(20)]])]]));

async function setup(today = '2026-09-30') {
  const db = testDb();
  seedStudios(db);
  const { tmdb } = fakeTmdb({ details: { 1399: fx<TmdbTvDetails>('tv-1399') }, seasons: { '1399:1': fx<TmdbSeason>('tv-1399-season-1') } });
  const t = await syncTitle(db, tmdb, 1399, { now: 1 });
  addSource(db, { name: 'J', url: 'http://j/api', apiKey: 'k' });
  const fq = fakeQbit();
  const fetchTorrent = async (r: Release) => (r.parsed.pack ? pack(`${r.title.slice(0, 20)} #${r.id}`) : single(`${r.title.slice(0, 20)} #${r.id}.mkv`));
  const deps = { qbit: fq.qbit, fetchTorrent, paths: { qbitDownloads: '/downloads', downloads: '/tmp/x', media: '/tmp/y' }, searchOpts: { fetchImpl: (async () => new Response(xml)) as typeof fetch }, today, now: 1 };
  const profile = (o: Partial<Profile> = {}): Profile => ({ ...builtinProfile(db, 'series'), scope: { mode: 'all' }, ...o });
  return { db, t, fq, deps, profile };
}

test('серии одного пака — одна загрузка; повторный поиск ничего не добавляет', async () => {
  const { db, t, fq, deps, profile } = await setup();
  subscribe(db, t.id, profile(), 1);
  const r = await searchSubscription(db, t.id, deps);
  expect(r.started).toBe(1);
  const d = db.select().from(downloads).all();
  expect(d).toHaveLength(1);
  expect(d[0]).toMatchObject({ kind: 'pack', episodes: [{ season: 1, number: 1 }, { season: 1, number: 2 }], studioLabel: 'LostFilm' });
  expect(fq.torrents.get(d[0].hash)!.files.filter((f) => f.priority > 0).map((f) => f.index)).toEqual([0, 1]);
  expect((await searchSubscription(db, t.id, deps)).started).toBe(0);
  expect(db.select().from(downloads).all()).toHaveLength(1);
});

test('ожидание озвучки — в состояние серии с датой', async () => {
  const { db, t, deps, profile } = await setup('2026-09-30');
  db.update(episodesT).set({ airDate: '2026-09-28' }).where(and(eq(episodesT.titleId, t.id), eq(episodesT.number, 1))).run();
  db.update(episodesT).set({ airDate: '2026-12-01' }).where(and(eq(episodesT.titleId, t.id), eq(episodesT.number, 2))).run();
  const hd = findStudioByAlias(db, 'HDrezka')!.id;
  subscribe(db, t.id, profile({ dubs: [{ kind: 'studio', studioId: hd, waitDays: 0 }, { kind: 'any', waitDays: 5 }] }), 1);
  const r = await searchSubscription(db, t.id, deps);
  expect(r).toMatchObject({ started: 0, waiting: 1 });
  expect(db.select().from(wantedState).get()).toMatchObject({ season: 1, number: 1, state: 'waiting', until: '2026-10-03' });
});

test('нет подходящих — «нет», без qBittorrent — не качаем', async () => {
  const { db, t, deps, profile } = await setup();
  const tvs = findStudioByAlias(db, 'TVShows')!.id;
  subscribe(db, t.id, profile({ dubs: [{ kind: 'studio', studioId: tvs, waitDays: 0 }] }), 1);
  expect((await searchSubscription(db, t.id, deps)).missing).toBe(2);
  expect(db.select().from(wantedState).all().map((w) => w.state)).toEqual(['missing', 'missing']);
  const other = await setup();
  subscribe(other.db, other.t.id, other.profile(), 1);
  const r = await searchSubscription(other.db, other.t.id, { ...other.deps, qbit: null });
  expect(r.started).toBe(0);
  expect(other.db.select().from(wantedState).get()).toMatchObject({ state: 'missing', reason: 'qBittorrent не подключён' });
});

test('сезон целиком после финала: до финала ждём, после — одна загрузка сезона', async () => {
  const { db, t, deps, profile } = await setup();
  subscribe(db, t.id, profile({ wholeSeasonAfterFinale: true }), 1);
  db.update(episodesT).set({ airDate: '2026-10-05' }).where(and(eq(episodesT.titleId, t.id), eq(episodesT.number, 3))).run();
  await searchSubscription(db, t.id, deps);
  expect(db.select().from(downloads).all()).toHaveLength(0);
  expect(db.select().from(wantedState).all().every((w) => w.reason === 'Ждём финал сезона')).toBe(true);
  db.update(episodesT).set({ airDate: '2011-05-01' }).where(and(eq(episodesT.titleId, t.id), eq(episodesT.number, 3))).run();
  await searchSubscription(db, t.id, deps);
  const d = db.select().from(downloads).all();
  expect(d).toHaveLength(1);
  expect(d[0]).toMatchObject({ kind: 'season', episodes: [{ season: 1, number: 1 }, { season: 1, number: 2 }, { season: 1, number: 3 }] });
});

test('ошибка одной подписки не мешает остальным', async () => {
  const { db, t, deps, profile } = await setup();
  subscribe(db, t.id, profile(), 1);
  const r = await searchAll(db, { ...deps, fetchTorrent: async () => { throw new Error('сломалось'); } });
  expect(r).toMatchObject({ titles: 1, errors: 0 });
  expect(db.select().from(wantedState).all().map((w) => w.reason)).toContain('сломалось');
});

test('раздачу убрали из клиента — её больше не берём', async () => {
  const { db, t, fq, deps, profile } = await setup();
  subscribe(db, t.id, profile(), 0);
  await searchSubscription(db, t.id, deps);
  const d = db.select().from(downloads).get()!;
  db.update(downloads).set({ state: 'removed' }).run();
  fq.torrents.delete(d.hash);
  await searchSubscription(db, t.id, deps);
  expect(db.select().from(downloads).all().filter((x) => x.releaseId === d.releaseId)).toHaveLength(1);
  expect(db.select().from(downloads).all().filter((x) => x.state !== 'removed').every((x) => x.releaseId !== d.releaseId)).toBe(true);
});

test('ошибка пака по одной серии не отсекает раздачу для других серий', async () => {
  const { db, t, deps, profile } = await setup();
  subscribe(db, t.id, profile(), 0);
  await searchSubscription(db, t.id, deps);
  const d = db.select().from(downloads).get()!;
  // будто раньше в этом паке не нашли файл S01E02, а S01E01 — ещё нужна
  db.update(downloads).set({ state: 'error', episodes: [{ season: 1, number: 2 }], hash: 'f'.repeat(40) }).run();
  await searchSubscription(db, t.id, deps);
  const fresh = db.select().from(downloads).all().filter((x) => x.state !== 'error');
  expect(fresh.find((x) => x.releaseId === d.releaseId)?.episodes).toEqual([{ season: 1, number: 1 }]);
});

test('застрявшая раздача меняется на следующую по рейтингу', async () => {
  const { db, t, fq, deps, profile } = await setup();
  subscribe(db, t.id, profile(), 0);
  await searchSubscription(db, t.id, deps);
  const stuck = db.select().from(downloads).get()!;
  db.update(downloads).set({ state: 'stalled' }).run();
  const r = await searchSubscription(db, t.id, deps);
  expect(r.started).toBe(1);
  const fresh = db.select().from(downloads).all().find((x) => x.id !== stuck.id)!;
  expect(fresh.episodes).toEqual([{ season: 1, number: 1 }, { season: 1, number: 2 }]);
  expect(db.select().from(downloads).where(eq(downloads.id, stuck.id)).get()).toMatchObject({ state: 'replaced', replacedById: fresh.id, note: 'Заменена: нет сидов' });
  expect(fq.torrents.has(stuck.hash)).toBe(false);
});

test('застрявшая без замены остаётся как есть', async () => {
  const { db, t, fq, deps, profile } = await setup();
  subscribe(db, t.id, profile(), 0);
  await searchSubscription(db, t.id, deps);
  const stuck = db.select().from(downloads).get()!;
  db.update(downloads).set({ state: 'stalled' }).run();
  // других подходящих раздач нет: 720p убрали из клиента раньше
  const { releases } = await import('@/lib/db/schema');
  const r720 = db.select().from(releases).all().find((x) => x.title.includes('720p'))!;
  db.insert(downloads).values({ hash: 'c'.repeat(40), titleId: t.id, releaseId: r720.id, season: 1, kind: 'pack', episodes: [], state: 'removed', name: 'x', size: 1, addedAt: 1 }).run();
  const r = await searchSubscription(db, t.id, deps);
  expect(r.started).toBe(0);
  expect(db.select().from(downloads).where(eq(downloads.id, stuck.id)).get()!.state).toBe('stalled');
  expect(fq.torrents.has(stuck.hash)).toBe(true);
  expect(db.select().from(wantedState).all()).toEqual([]);
});

const setAir = (db: Awaited<ReturnType<typeof setup>>['db'], titleId: number, n: number, airDate: string | null) =>
  db.update(episodesT).set({ airDate }).where(and(eq(episodesT.titleId, titleId), eq(episodesT.number, n))).run();

test('сезон целиком учитывает «начиная с серии» и скачанные серии', async () => {
  const { db, t, deps, profile } = await setup();
  setAir(db, t.id, 3, '2011-05-01');
  subscribe(db, t.id, profile({ wholeSeasonAfterFinale: true, scope: { mode: 'from', season: 1, episode: 2, until: 'season_end' } }), 1);
  db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: 2, path: 'x/2.mkv', size: 1, method: 'hardlink', importedAt: 1 }).run();
  await searchSubscription(db, t.id, deps);
  expect(db.select().from(downloads).get()).toMatchObject({ kind: 'season', episodes: [{ season: 1, number: 3 }] });
});

test('серия без даты: сезон закончен, если пак заявляет весь сезон', async () => {
  const { db, t, deps, profile } = await setup();
  subscribe(db, t.id, profile({ wholeSeasonAfterFinale: true }), 1);
  await searchSubscription(db, t.id, deps); // E3 без даты, паки «S1E1-10 of 10»
  expect(db.select().from(downloads).get()).toMatchObject({ kind: 'season', episodes: [1, 2, 3].map((number) => ({ season: 1, number })) });
});

test('устаревшие статусы серий убираются при поиске', async () => {
  const { db, t, deps, profile } = await setup();
  subscribe(db, t.id, profile({ scope: { mode: 'from', season: 1, episode: 3, until: 'season_end' } }), 1);
  db.insert(wantedState).values({ titleId: t.id, season: 1, number: 1, state: 'waiting', reason: 'Рано', until: '2026-10-03', checkedAt: 1 }).run();
  await searchSubscription(db, t.id, deps);
  expect(db.select().from(wantedState).all().filter((w) => w.number === 1)).toEqual([]);
});

test('сбой включения файла у одной серии не мешает остальным', async () => {
  const { db, t, fq, deps, profile } = await setup();
  subscribe(db, t.id, profile(), 1);
  await searchSubscription(db, t.id, deps);
  const d = db.select().from(downloads).get()!;
  // в паке качается только E1; E2 и E3 надо включить
  db.update(downloads).set({ episodes: [{ season: 1, number: 1 }], files: d.files!.map((f) => ({ ...f, priority: f.index === 0 ? 1 : 0 })) }).run();
  setAir(db, t.id, 3, '2011-05-01');
  const qbit = { ...fq.qbit, setFilePriority: async (...a: Parameters<typeof fq.qbit.setFilePriority>) => { if (a[1].includes(1)) throw new Error('qBittorrent не отвечает'); return fq.qbit.setFilePriority(...a); } };
  await searchSubscription(db, t.id, { ...deps, qbit });
  expect(db.select().from(wantedState).all()).toEqual([expect.objectContaining({ number: 2, state: 'missing', reason: 'qBittorrent не отвечает' })]);
  expect(db.select().from(downloads).get()!.episodes).toEqual([{ season: 1, number: 1 }, { season: 1, number: 3 }]);
});

test('сезон без дат: «весь сезон» заявляют только отклонённые раздачи — ждём финал', async () => {
  const { db, t, deps, profile } = await setup();
  const p = profile({ wholeSeasonAfterFinale: true });
  subscribe(db, t.id, { ...p, quality: { ...p.quality, maxSizeGb: 0.5 } }, 1); // все паки больше лимита
  await searchSubscription(db, t.id, deps);
  expect(db.select().from(downloads).all()).toEqual([]);
  const ws = db.select().from(wantedState).all();
  expect(ws.length).toBeGreaterThan(0);
  expect(ws.every((w) => w.reason === 'Ждём финал сезона')).toBe(true);
});

test('серия в запасной озвучке меняется на приоритетную; статуса «нужна» нет', async () => {
  const { db, t, deps, profile } = await setup();
  const lf = findStudioByAlias(db, 'LostFilm')!;
  subscribe(db, t.id, profile({ dubs: [{ kind: 'studio', studioId: lf.id, waitDays: 0 }, { kind: 'any', waitDays: 0 }] }), 1);
  setAir(db, t.id, 1, '2026-09-28');
  setAir(db, t.id, 3, '2026-10-20');
  db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: 1, path: 'x/1.mkv', size: 1, method: 'hardlink', importedAt: 1, studioLabel: 'Кураж-Бамбей', resolution: 720, dubPosition: 1 }).run();
  db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: 2, path: 'x/2.mkv', size: 1, method: 'hardlink', importedAt: 1, studioLabel: 'LostFilm', resolution: 1080, dubPosition: 0 }).run();
  const r = await searchSubscription(db, t.id, deps);
  expect(r.started).toBe(1);
  expect(db.select().from(downloads).get()).toMatchObject({ episodes: [{ season: 1, number: 1 }], dubPosition: 0, note: 'Улучшение: Кураж-Бамбей → LostFilm', studioLabel: 'LostFilm' });
  expect(db.select().from(wantedState).all()).toEqual([]);
  expect((await searchSubscription(db, t.id, deps)).started).toBe(0); // уже качается
});

test('обычная загрузка запоминает позицию профиля', async () => {
  const { db, t, deps, profile } = await setup();
  subscribe(db, t.id, profile(), 1);
  await searchSubscription(db, t.id, deps);
  expect(db.select().from(downloads).get()!.dubPosition).toBe(0);
});
