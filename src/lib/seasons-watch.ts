import { isMovieProfile } from './movie-profile';
import { and, eq, max } from 'drizzle-orm';
import type { Db } from './db/client';
import { notices, seasons, subscriptions } from './db/schema';
import { addNotice } from './notices';

// Автоподписка на новые сезоны (spec §11): TMDB объявил сезон за границей подписки.

export const lastSeason = (db: Db, titleId: number): number | null =>
  db
    .select({ n: max(seasons.number) })
    .from(seasons)
    .where(eq(seasons.titleId, titleId))
    .get()?.n ?? null;

export function extendSeasons(db: Db, titleId: number, now = Date.now()): 'extended' | 'noted' | 'none' {
  const sub = db.select().from(subscriptions).where(eq(subscriptions.titleId, titleId)).get();
  const last = lastSeason(db, titleId);
  if (!sub || sub.maxSeason === null || last === null || last <= sub.maxSeason) return 'none';
  if (!isMovieProfile(sub.profile) && sub.profile.autoNextSeason) {
    db.update(subscriptions).set({ maxSeason: last }).where(eq(subscriptions.id, sub.id)).run();
    addNotice(db, titleId, 'season-subscribed', `Подписался на ${last}-й сезон`, now);
    return 'extended';
  }
  const text = `Вышел ${last}-й сезон — подписка его не включает`;
  if (db.select().from(notices).where(and(eq(notices.titleId, titleId), eq(notices.text, text))).get()) return 'none';
  addNotice(db, titleId, 'season-not-included', text, now);
  return 'noted';
}
