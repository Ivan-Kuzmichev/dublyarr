import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { studios, subscriptions, titles } from '@/lib/db/schema';
import type { Profile } from '@/lib/profile';

test('подписка — одна на сериал, удаляется вместе с сериалом', () => {
  const db = testDb();
  const t = db
    .insert(titles)
    .values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 })
    .returning()
    .get();
  const s = db.insert(studios).values({ name: 'LostFilm', kind: 'series', source: 'seed', createdAt: 1 }).returning().get();
  expect(s.aliases).toEqual([]);
  const profile: Profile = {
    dubs: [{ kind: 'studio', studioId: s.id, waitDays: 0 }],
    quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: null },
    scope: { mode: 'new' },
    wholeSeasonAfterFinale: false,
    replaceWithHigher: true,
    autoNextSeason: true,
  };
  db.insert(subscriptions).values({ titleId: t.id, profile, subscribedAt: 1, updatedAt: 1 }).run();
  expect(db.select().from(subscriptions).get()!.profile).toEqual(profile);
  expect(() => db.insert(subscriptions).values({ titleId: t.id, profile, subscribedAt: 1, updatedAt: 1 }).run()).toThrow();
  db.delete(titles).run();
  expect(db.select().from(subscriptions).all()).toEqual([]);
});
