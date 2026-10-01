import { desc, eq, gte } from 'drizzle-orm';
import type { Db } from './db/client';
import { notices, titles } from './db/schema';
import { notifyNotice } from './notify-events';

// Заметки для «Сегодня» (в 2d — и для Telegram).

export const NOTICE_DAYS = 3;

export function addNotice(db: Db, titleId: number, kind: (typeof notices.$inferInsert)['kind'], text: string, now = Date.now()) {
  const row = db.insert(notices).values({ titleId, kind, text, createdAt: now }).returning().get();
  notifyNotice(db, row.id, titleId, text, now);
}

export function recentNotices(db: Db, now = Date.now()) {
  return db
    .select({ tmdbId: titles.tmdbId, title: titles.nameRu, text: notices.text, createdAt: notices.createdAt })
    .from(notices)
    .innerJoin(titles, eq(titles.id, notices.titleId))
    .where(gte(notices.createdAt, now - NOTICE_DAYS * 86_400_000))
    .orderBy(desc(notices.createdAt))
    .all();
}
