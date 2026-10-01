import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { downloads, episodeFiles, wantedState, titles, releases, sources } from '@/lib/db/schema';
import type { ParsedRelease } from '@/lib/parse/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('загрузки, файлы серий, состояние серий: уникальность и каскады', () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const parsed = { base: 'a', names: [], year: null, seasons: [1], episodes: null, totalInSeason: null, absolute: false, pack: true, resolution: 1080, source: null, hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false } as ParsedRelease;
  const r = db.insert(releases).values({ titleId: t.id, sourceId: s.id, trackerName: 'X', title: 'A', size: 1, firstSeenAt: 1, lastSeenAt: 1, parsed, match: { score: 1, level: 'match', reasons: [] } }).returning().get();
  const d = db
    .insert(downloads)
    .values({ hash: 'aa', titleId: t.id, releaseId: r.id, season: 1, kind: 'pack', episodes: [{ season: 1, number: 2 }], state: 'downloading', name: 'A S01', size: 10, addedAt: 1 })
    .returning()
    .get();
  expect(d).toMatchObject({ progress: 0, episodes: [{ season: 1, number: 2 }] });
  expect(() => db.insert(downloads).values({ hash: 'aa', titleId: t.id, season: 1, kind: 'pack', episodes: [], state: 'adding', name: 'x', size: 1, addedAt: 1 }).run()).toThrow();
  db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: 2, path: 'A/S01E02.mkv', size: 10, downloadId: d.id, method: 'hardlink', importedAt: 2 }).run();
  expect(() => db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: 2, path: 'x', size: 1, method: 'copy', importedAt: 3 }).run()).toThrow();
  db.insert(wantedState).values({ titleId: t.id, season: 1, number: 3, state: 'waiting', reason: 'Рано', until: '2026-10-03', checkedAt: 1 }).run();
  db.delete(releases).run();
  expect(db.select().from(downloads).get()!.releaseId).toBeNull();
  db.delete(titles).run();
  expect(db.select().from(downloads).all()).toEqual([]);
  expect(db.select().from(episodeFiles).all()).toEqual([]);
  expect(db.select().from(wantedState).all()).toEqual([]);
});
