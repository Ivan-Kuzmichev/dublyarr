import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { downloads, episodeFiles, subscriptions, titles } from '@/lib/db/schema';
import type { Profile } from '@/lib/profile-core';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('время последнего поиска и пауза по расписанию', () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(subscriptions).values({ titleId: t.id, profile: {} as Profile, subscribedAt: 1, updatedAt: 1 }).returning().get();
  expect(s.lastSearchedAt).toBeNull();
  const d = db.insert(downloads).values({ hash: 'h', titleId: t.id, season: 1, kind: 'episode', episodes: [], state: 'adding', name: 'x', size: 1, addedAt: 1 }).returning().get();
  expect(d.pausedBySchedule).toBe(false);
});

test('фаза 3a: признаки пересборки у файла и загрузки', () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 2, kind: 'series', nameRu: 'B', nameOriginal: 'B', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const f = db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: 1, path: 'p', size: 1, method: 'copy', importedAt: 1 }).returning().get();
  expect(f).toMatchObject({ processed: false, hdr: false, duration: null, tracks: null });
  const d = db.insert(downloads).values({ hash: 'h3', titleId: t.id, season: 1, kind: 'episode', episodes: [], state: 'adding', name: 'x', size: 1, addedAt: 1 }).returning().get();
  expect(d.processing).toBe(false);
});
