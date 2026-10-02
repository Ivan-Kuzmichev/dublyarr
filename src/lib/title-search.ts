import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import { jobs, titles } from './db/schema';
import { enqueue } from '../worker/jobs';

// Поиск раздач при открытии страницы сериала/фильма (даже без подписки) — чтобы окно подписки знало найденные студии.
// Ищет воркер (задача title.search); результат — в releases, время — titles.releases_searched_at (его же ставит searchTitle).

export const SEARCH_TTL = 6 * 3_600_000;
export const TITLE_SEARCH = 'title.search';

const payloadOf = (titleId: number) => JSON.stringify({ titleId });

export function titleSearchPending(db: Db, titleId: number): boolean {
  return !!db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, TITLE_SEARCH), eq(jobs.payload, payloadOf(titleId)), inArray(jobs.status, ['queued', 'running'])))
    .get();
}

/** Поставить поиск, если давно не искали и он ещё не идёт. pending — поиск идёт (или поставлен). */
export function requestTitleSearch(db: Db, titleId: number, now = Date.now()): { pending: boolean } {
  if (titleSearchPending(db, titleId)) return { pending: true };
  const t = db.select({ at: titles.releasesSearchedAt }).from(titles).where(eq(titles.id, titleId)).get();
  if (!t || (t.at && now - t.at < SEARCH_TTL)) return { pending: false };
  enqueue(db, TITLE_SEARCH, { titleId }, now);
  return { pending: true };
}
