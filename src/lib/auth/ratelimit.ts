import { and, gt, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { authFailures } from '../db/schema';

export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60_000;

export function recordFailure(db: Db, keys: string[], now = Date.now()) {
  db.insert(authFailures)
    .values(keys.map((key) => ({ key, at: now })))
    .run();
}

/** Заблокирован, если хотя бы по одному ключу (IP или логин) набралось MAX_FAILURES неудач за окно. */
export function isBlocked(db: Db, keys: string[], now = Date.now()) {
  const rows = db
    .select({ key: authFailures.key, n: sql<number>`count(*)` })
    .from(authFailures)
    .where(and(inArray(authFailures.key, keys), gt(authFailures.at, now - WINDOW_MS)))
    .groupBy(authFailures.key)
    .all();
  return rows.some((r) => r.n >= MAX_FAILURES);
}

export const clearFailures = (db: Db, keys: string[]) => db.delete(authFailures).where(inArray(authFailures.key, keys)).run();
export const prune = (db: Db, now = Date.now()) => db.delete(authFailures).where(lte(authFailures.at, now - WINDOW_MS)).run();
