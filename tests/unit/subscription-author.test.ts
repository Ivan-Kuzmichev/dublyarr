import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { subscribe, subscriptionAuthor } from '@/lib/subscriptions';
import { builtinProfile } from '@/lib/profile';
import { seedStudios } from '@/lib/studios';
import { titles, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

test('подписка помнит, кто её добавил; удалённая учётка и старые подписки', () => {
  const db = testDb();
  seedStudios(db);
  const anya = db.insert(users).values({ username: 'anya', passwordHash: 'x', role: 'user', createdAt: 1, updatedAt: 1 }).returning().get();
  const t = (n: number) => db.insert(titles).values({ tmdbId: n, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const a = subscribe(db, t(1).id, builtinProfile(db, 'series'), 1, anya.id);
  expect(a.addedBy).toBe(anya.id);
  expect(subscriptionAuthor(db, a)).toBe('anya');
  const old = subscribe(db, t(2).id, builtinProfile(db, 'series'), 1);
  expect(subscriptionAuthor(db, old)).toBeNull();
  db.update(users).set({ username: 'anya2' }).where(eq(users.id, anya.id)).run();
  expect(subscriptionAuthor(db, a)).toBe('anya2');
  expect(subscriptionAuthor(db, { addedBy: 999 })).toBe('удалённая учётка');
});
