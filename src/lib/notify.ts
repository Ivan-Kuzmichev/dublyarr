import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import type { Db } from './db/client';
import { notifications } from './db/schema';
import { getSetting } from './settings';
import { TelegramError, type InlineButton, type Telegram } from './telegram';
import { log } from './log';

// Очередь сообщений в Telegram (spec §12): события пишутся сразу, воркер отправляет; Telegram недоступен — повторы с паузой.

export type NotifyKind = 'downloaded' | 'stuck' | 'ask' | 'original' | 'source-down';
export const DEFAULT_EVENTS: Record<NotifyKind, boolean> = { downloaded: true, stuck: true, ask: true, original: false, 'source-down': true };
export const getEvents = (db: Db): Record<NotifyKind, boolean> => ({ ...DEFAULT_EVENTS, ...getSetting<Partial<Record<NotifyKind, boolean>>>(db, 'telegram.events') });

const MIN = 60_000;
const GIVE_UP = 24 * 60 * MIN;

/** Записать событие в очередь; false — событие выключено или такое уже было (ключ). */
export function notify(db: Db, n: { key: string; kind: NotifyKind; text: string; buttons?: InlineButton[][]; ref?: Record<string, unknown> }, now = Date.now()): boolean {
  if (!getEvents(db)[n.kind]) return false;
  const row = db
    .insert(notifications)
    .values({ key: n.key, kind: n.kind, text: n.text, buttons: n.buttons ?? null, ref: n.ref ?? null, createdAt: now, nextAt: now })
    .onConflictDoNothing()
    .returning()
    .get();
  return !!row;
}

/** Отправить накопившееся. Ошибка сети — повтор через 2, 4, 8… мин (не больше часа); сутки — «не доставлено». */
export async function sendPending(db: Db, tg: Telegram, chatId: string, now = Date.now()) {
  const res = { sent: 0, failed: 0 };
  const due = db
    .select()
    .from(notifications)
    .where(and(isNull(notifications.sentAt), isNull(notifications.error), lte(notifications.nextAt, now)))
    .orderBy(asc(notifications.id))
    .limit(20)
    .all();
  for (const n of due) {
    if (now - n.createdAt > GIVE_UP) {
      db.update(notifications).set({ error: 'не доставлено' }).where(eq(notifications.id, n.id)).run();
      continue;
    }
    try {
      const { messageId } = await tg.sendMessage(chatId, n.text, n.buttons ?? undefined);
      db.update(notifications).set({ sentAt: now, messageId }).where(eq(notifications.id, n.id)).run();
      res.sent++;
    } catch (e) {
      res.failed++;
      const attempts = n.attempts + 1;
      if (e instanceof TelegramError && e.code === 'rate') {
        db.update(notifications).set({ attempts, nextAt: now + (e.retryAfter ?? 30) * 1000 }).where(eq(notifications.id, n.id)).run();
        break; // Telegram просит подождать — остальное тоже позже
      }
      if (e instanceof TelegramError && (e.code === 'blocked' || e.code === 'auth')) {
        db.update(notifications).set({ attempts, error: e.message }).where(eq(notifications.id, n.id)).run();
        continue;
      }
      db.update(notifications)
        .set({ attempts, nextAt: now + Math.min(2 ** attempts * MIN, 60 * MIN) })
        .where(eq(notifications.id, n.id))
        .run();
      log.warn({ notification: n.id, err: e instanceof Error ? e.message : String(e) }, 'telegram send failed');
    }
  }
  return res;
}

export function parseEventsForm(form: FormData): Record<NotifyKind, boolean> {
  return Object.fromEntries((Object.keys(DEFAULT_EVENTS) as NotifyKind[]).map((k) => [k, form.get(k) === 'on'])) as Record<NotifyKind, boolean>;
}
