import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { fakeQbit } from './fake-qbit';
import { bencode } from '@/lib/torrent-file';
import { startRelease } from '@/lib/downloads';
import { checkPacks, watchedPacks } from '@/lib/pack-watch';
import { downloads, episodeFiles, episodes, releases, sources, subscriptions, titles, type Release } from '@/lib/db/schema';
import { encrypt } from '@/lib/crypto/secretbox';
import type { ParsedRelease } from '@/lib/parse/types';
import type { Profile } from '@/lib/profile-core';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const b = (s: string) => Buffer.from(s);
function torrent(files: string[], version = 1) {
  const info = new Map<string, unknown>([['name', b('A S01')], ['piece length', version], ['pieces', Buffer.alloc(20)]]);
  info.set('files', files.map((f) => new Map<string, unknown>([['length', 100], ['path', [b(f)]]])));
  return bencode(new Map<string, unknown>([['info', info]]));
}
const parsed: ParsedRelease = {
  base: 'x', names: [], year: null, seasons: [1], episodes: null, totalInSeason: null, absolute: false, pack: true,
  resolution: 1080, source: 'webdl', hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false,
};
const profile: Profile = {
  dubs: [{ kind: 'any', waitDays: 0 }],
  quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: null },
  scope: { mode: 'all' },
  wholeSeasonAfterFinale: false,
  replaceWithHigher: true,
  autoNextSeason: true,
};
const today = '2026-09-30';
const ep = (number: number) => ({ season: 1, number });
const v1 = torrent(['A.S01E01.mkv', 'A.S01E02.mkv']);
const v2 = torrent(['A.S01E01.mkv', 'A.S01E02.mkv', 'A.S01E03.mkv'], 2);

async function setup(o: { dates?: (string | null)[]; details?: string | null } = {}) {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  (o.dates ?? ['2026-09-01', '2026-09-08', '2026-09-29']).forEach((airDate, i) => db.insert(episodes).values({ titleId: t.id, season: 1, number: i + 1, name: `E${i + 1}`, airDate }).run());
  db.insert(subscriptions).values({ titleId: t.id, profile, subscribedAt: 0, updatedAt: 0 }).run();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const r = db
    .insert(releases)
    .values({ titleId: t.id, sourceId: s.id, trackerName: 'X', title: 'A S01', size: 100, firstSeenAt: 1, lastSeenAt: 1, parsed, match: { score: 1, level: 'match', reasons: [] }, detailsUrl: o.details === undefined ? 'https://t/1' : o.details, downloadEnc: encrypt('http://j/dl/1') })
    .returning()
    .get();
  const fq = fakeQbit();
  const current = { torrent: v1 };
  const deps = { qbit: fq.qbit, fetchTorrent: async (_r: Release) => current.torrent, paths: { qbitDownloads: '/downloads' }, now: 10, today };
  const d = await startRelease(db, deps, r, [ep(1), ep(2)], 'pack', null);
  const imported = (...n: number[]) => {
    for (const x of n) db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: x, path: `A/${x}.mkv`, size: 1, downloadId: d.id, method: 'hardlink', importedAt: 5 }).run();
    db.update(downloads).set({ state: 'imported' }).run();
  };
  return { db, t, r, fq, deps, d, current, imported };
}

test('какие паки отслеживаются', async () => {
  const a = await setup();
  a.imported(1, 2);
  expect(watchedPacks(a.db, today).map((x) => x.id)).toEqual([a.d.id]); // E3 вышла, файла нет

  const done = await setup({ dates: ['2026-09-01', '2026-09-08'] });
  done.imported(1, 2);
  expect(watchedPacks(done.db, today)).toEqual([]); // сезон вышел и скачан

  const future = await setup({ dates: ['2026-09-01', '2026-09-08', null] });
  future.imported(1, 2);
  expect(watchedPacks(future.db, today)).toHaveLength(1); // серия без даты ещё впереди

  const noTopic = await setup({ details: null });
  expect(watchedPacks(noTopic.db, today)).toEqual([]);

  const unsub = await setup();
  unsub.db.delete(subscriptions).run();
  expect(watchedPacks(unsub.db, today)).toEqual([]);

  const rep = await setup();
  rep.db.update(downloads).set({ state: 'replaced' }).run();
  expect(watchedPacks(rep.db, today)).toEqual([]);
});

test('хэш сменился и вышла E3 — переключение; не сменился — ничего; второй раз подряд — ничего', async () => {
  const { db, deps, current, imported } = await setup();
  imported(1, 2);
  expect(await checkPacks(db, deps)).toEqual({ checked: 1, switched: 0, errors: 0 });
  current.torrent = v2;
  expect(await checkPacks(db, deps)).toEqual({ checked: 1, switched: 1, errors: 0 });
  expect(await checkPacks(db, deps)).toEqual({ checked: 1, switched: 0, errors: 0 });
  expect(db.select().from(downloads).all().map((x) => x.state).sort()).toEqual(['downloading', 'replaced']);
});

test('ошибка одной проверки не мешает остальным', async () => {
  const { db, deps, current, imported, t, r } = await setup();
  imported(1, 2);
  // второй сериал с тем же паком (другой топик)
  const t2 = db.insert(titles).values({ tmdbId: 2, kind: 'series', nameRu: 'B', nameOriginal: 'B', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  for (let i = 1; i <= 3; i++) db.insert(episodes).values({ titleId: t2.id, season: 1, number: i, name: `E${i}`, airDate: '2026-09-01' }).run();
  db.insert(subscriptions).values({ titleId: t2.id, profile, subscribedAt: 0, updatedAt: 0 }).run();
  const r2 = db.insert(releases).values({ ...r, id: undefined, titleId: t2.id, detailsUrl: 'https://t/2' }).returning().get();
  db.insert(downloads).values({ hash: 'b'.repeat(40), titleId: t2.id, releaseId: r2.id, season: 1, kind: 'pack', episodes: [ep(1)], state: 'imported', name: 'B', size: 1, addedAt: 1 }).run();
  current.torrent = v2;
  const res = await checkPacks(db, { ...deps, fetchTorrent: async (x: Release) => (x.titleId === t.id ? Promise.reject(new Error('сеть')) : current.torrent) });
  expect(res).toEqual({ checked: 2, switched: 1, errors: 1 });
});
