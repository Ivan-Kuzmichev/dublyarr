import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { downloads, episodeFiles, notices, oldCopies, studioSightings, studios, subscriptions, titles } from '@/lib/db/schema';
import type { Profile } from '@/lib/profile-core';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('наблюдения, старые копии, заметки; новые колонки', () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const st = db.insert(studios).values({ name: 'Студия X', kind: 'both', source: 'manual', createdAt: 1 }).returning().get();
  db.insert(studioSightings).values({ titleId: t.id, studioId: st.id, season: 1, number: 2, seenAt: 5, basis: 'seen', fromPack: false }).run();
  expect(() => db.insert(studioSightings).values({ titleId: t.id, studioId: st.id, season: 1, number: 2, seenAt: 6, basis: 'published', fromPack: true }).run()).toThrow();
  expect(db.select().from(studioSightings).get()).toMatchObject({ basis: 'seen', fromPack: false });
  db.insert(oldCopies).values({ titleId: t.id, season: 1, number: 2, path: '.dublyarr-old/A/x.mkv', size: 10, reason: 'LostFilm → HDrezka', createdAt: 1 }).run();
  db.insert(notices).values({ titleId: t.id, kind: 'season-subscribed', text: 'Подписался на 3-й сезон', createdAt: 1 }).run();
  const f = db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: 1, path: 'p', size: 1, method: 'copy', importedAt: 1, dubPosition: 1 }).returning().get();
  expect(f.dubPosition).toBe(1);
  const d = db.insert(downloads).values({ hash: 'h', titleId: t.id, season: 1, kind: 'episode', episodes: [], state: 'adding', name: 'x', size: 1, addedAt: 1, dubPosition: 0 }).returning().get();
  expect(d.dubPosition).toBe(0);
  const s = db.insert(subscriptions).values({ titleId: t.id, profile: {} as Profile, subscribedAt: 1, updatedAt: 1, maxSeason: 2 }).returning().get();
  expect(s.maxSeason).toBe(2);
  db.delete(titles).run();
  expect([db.select().from(studioSightings).all(), db.select().from(oldCopies).all(), db.select().from(notices).all()]).toEqual([[], [], []]);
});
