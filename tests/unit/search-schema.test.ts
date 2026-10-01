import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { releases, releaseRules, sources, titles, trackers } from '@/lib/db/schema';
import type { ParsedRelease } from '@/lib/parse/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

const parsed: ParsedRelease = {
  base: 'x', names: [], year: null, seasons: [1], episodes: null, totalInSeason: null, absolute: false, pack: true,
  resolution: 1080, source: 'webdl', hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false,
};
const match = { score: 1, level: 'match' as const, reasons: [] };

test('релизы: дубль по infohash запрещён, без infohash — по трекеру+заголовку+размеру; каскады', () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const tr = db.insert(trackers).values({ sourceId: s.id, indexerId: 'rutracker', name: 'RuTracker.org', role: 'primary' }).returning().get();
  const row = { titleId: t.id, sourceId: s.id, trackerId: tr.id, trackerName: 'RuTracker.org', size: 100, firstSeenAt: 1, lastSeenAt: 1, parsed, match };
  db.insert(releases).values({ ...row, title: 'A S01', infohash: 'abc' }).run();
  expect(() => db.insert(releases).values({ ...row, title: 'A S01 другой', infohash: 'abc' }).run()).toThrow();
  db.insert(releases).values({ ...row, title: 'B', infohash: null }).run();
  db.insert(releases).values({ ...row, title: 'B', size: 200, infohash: null }).run();
  expect(() => db.insert(releases).values({ ...row, title: 'B', infohash: null }).run()).toThrow();
  db.insert(releaseRules).values({ titleId: t.id, trackerName: null, pattern: 'a', verdict: 'reject', createdAt: 1 }).run();
  expect(db.select().from(releases).get()!.parsed).toEqual(parsed);
  db.delete(titles).run();
  expect(db.select().from(releases).all()).toEqual([]);
  expect(db.select().from(releaseRules).all()).toEqual([]);
});
