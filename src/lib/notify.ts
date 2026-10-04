import { and, asc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Db } from './db/client';
import { notificationDeliveries, notifications, users } from './db/schema';
import { can, type Permission } from './auth/permissions';
import { TelegramError, type InlineButton, type Telegram } from './telegram';
import { logger } from './log';

const log = logger('telegram');

// Очередь сообщений в Telegram (spec §12): события пишутся сразу, воркер отправляет; Telegram недоступен — повторы с паузой.

export type NotifyKind = 'downloaded' | 'stuck' | 'ask' | 'original' | 'source-down';
export const DEFAULT_EVENTS: Record<NotifyKind, boolean> = { downloaded: true, stuck: true, ask: true, original: false, 'source-down': true };
/** События учётки: свои или по умолчанию. */
export const eventsOf = (u: { notifyEvents: Record<string, boolean> | null }): Record<NotifyKind, boolean> => ({ ...DEFAULT_EVENTS, ...(u.notifyEvents ?? {}) });

const MIN = 60_000;
const GIVE_UP = 24 * 60 * MIN;

/** Кому слать: привязан чат, учётка включена, событие включено; вопросы с кнопками — только с правом отвечать. */
/** Какое право нужно получателю: вопросы о раздачах — «Ответы», подтверждения удаления — «Хранилище» (need). */
const needOf = (kind: NotifyKind, need?: Permission | null): Permission | null => need ?? (kind === 'ask' ? 'answer' : null);

export function recipients(db: Db, kind: NotifyKind, need?: Permission | null) {
  const p = needOf(kind, need);
  return db
    .select()
    .from(users)
    .where(and(isNotNull(users.telegramChatId), eq(users.disabled, false)))
    .all()
    .filter((u) => eventsOf(u)[kind] && (!p || can(u, p)));
}

/** Записать событие в очередь с доставкой каждому получателю; false — никто не ждёт или такое уже было (ключ). */
export function notify(
  db: Db,
  n: { key: string; kind: NotifyKind; text: string; buttons?: InlineButton[][]; ref?: Record<string, unknown>; need?: Permission; delayMs?: number },
  now = Date.now(),
): boolean {
  const to = recipients(db, n.kind, n.need);
  if (!to.length) return false;
  return db.transaction((tx) => {
    const row = tx
      .insert(notifications)
      .values({ key: n.key, kind: n.kind, text: n.text, buttons: n.buttons ?? null, ref: n.need ? { ...n.ref, need: n.need } : (n.ref ?? null), createdAt: now, nextAt: now })
      .onConflictDoNothing()
      .returning()
      .get();
    if (!row) return false;
    for (const u of to) tx.insert(notificationDeliveries).values({ notificationId: row.id, userId: u.id, chatId: u.telegramChatId!, nextAt: now + (n.delayMs ?? 0) }).run();
    return true;
  });
}

/** Отправить накопившееся. Ошибка сети — повтор через 2, 4, 8… мин (не больше часа); сутки — «не доставлено». Повторы — у каждого получателя свои. */
export async function sendPending(db: Db, tg: Telegram, now = Date.now()) {
  const res = { sent: 0, failed: 0 };
  const due = db
    .select({ d: notificationDeliveries, n: notifications, u: users })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
    .innerJoin(users, eq(users.id, notificationDeliveries.userId))
    .where(and(isNull(notificationDeliveries.sentAt), isNull(notificationDeliveries.error), lte(notificationDeliveries.nextAt, now)))
    .orderBy(asc(notificationDeliveries.id))
    .limit(20)
    .all();
  for (const { d, n, u } of due) {
    // получатель мог измениться с момента события: выключен, сменил чат, лишился права
    const need = needOf(n.kind, (n.ref as { need?: Permission } | null)?.need);
    const stale = u.disabled ? 'учётка выключена' : u.telegramChatId !== d.chatId ? 'чат изменён' : need && !can(u, need) ? 'нет прав' : null;
    if (stale) {
      db.update(notificationDeliveries).set({ error: stale }).where(eq(notificationDeliveries.id, d.id)).run();
      continue;
    }
    if (now - n.createdAt > GIVE_UP) {
      db.update(notificationDeliveries).set({ error: 'не доставлено' }).where(eq(notificationDeliveries.id, d.id)).run();
      continue;
    }
    try {
      const { messageId } = await tg.sendMessage(d.chatId, n.text, n.buttons ?? undefined);
      db.update(notificationDeliveries).set({ sentAt: now, messageId }).where(eq(notificationDeliveries.id, d.id)).run();
      // событие считается отправленным с первой доставки (для «Последних сообщений»)
      if (!n.sentAt) db.update(notifications).set({ sentAt: now }).where(eq(notifications.id, n.id)).run();
      res.sent++;
    } catch (e) {
      res.failed++;
      const attempts = d.attempts + 1;
      if (e instanceof TelegramError && e.code === 'rate') {
        db.update(notificationDeliveries).set({ attempts, nextAt: now + (e.retryAfter ?? 30) * 1000 }).where(eq(notificationDeliveries.id, d.id)).run();
        break; // Telegram просит подождать — остальное тоже позже
      }
      if (e instanceof TelegramError && (e.code === 'blocked' || e.code === 'auth')) {
        db.update(notificationDeliveries).set({ attempts, error: e.message }).where(eq(notificationDeliveries.id, d.id)).run();
        continue;
      }
      db.update(notificationDeliveries)
        .set({ attempts, nextAt: now + Math.min(2 ** attempts * MIN, 60 * MIN) })
        .where(eq(notificationDeliveries.id, d.id))
        .run();
      log.warn({ delivery: d.id, err: e instanceof Error ? e.message : String(e) }, 'telegram send failed');
      // сеть недоступна — остальные не пробуем (каждая попытка ждала бы таймаут и держала воркер)
      if (e instanceof TelegramError && e.code === 'network') break;
    }
  }
  return res;
}

export function parseEventsForm(form: FormData): Record<NotifyKind, boolean> {
  return Object.fromEntries((Object.keys(DEFAULT_EVENTS) as NotifyKind[]).map((k) => [k, form.get(k) === 'on'])) as Record<NotifyKind, boolean>;
}
