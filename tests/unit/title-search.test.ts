import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers';
import { requestTitleSearch, titleSearchPending, SEARCH_TTL } from '@/lib/title-search';
import { jobs, titles } from '@/lib/db/schema';
import { claimNext, finish } from '@/worker/jobs';

const NOW = 1_800_000_000_000;

function setup() {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  return { db, t };
}

test('открыли страницу: поиск в фоне один раз; пока идёт — «ищем», повторно не ставится', () => {
  const { db, t } = setup();
  expect(requestTitleSearch(db, t.id, NOW)).toEqual({ pending: true });
  expect(requestTitleSearch(db, t.id, NOW + 1)).toEqual({ pending: true });
  expect(db.select().from(jobs).all().map((j) => [j.type, JSON.parse(j.payload)])).toEqual([['title.search', { titleId: t.id }]]);
  expect(titleSearchPending(db, t.id)).toBe(true);
  const job = claimNext(db, NOW + 2)!;
  expect(titleSearchPending(db, t.id)).toBe(true); // выполняется
  finish(db, job, undefined, NOW + 3);
  expect(titleSearchPending(db, t.id)).toBe(false);
});

test('искали недавно (меньше 6 ч) — не ищем; давно — ищем снова', () => {
  const { db, t } = setup();
  db.update(titles).set({ releasesSearchedAt: NOW - SEARCH_TTL + 60_000 }).where(eq(titles.id, t.id)).run();
  expect(requestTitleSearch(db, t.id, NOW)).toEqual({ pending: false });
  expect(db.select().from(jobs).all()).toEqual([]);
  expect(requestTitleSearch(db, t.id, NOW + 120_000)).toEqual({ pending: true });
});
