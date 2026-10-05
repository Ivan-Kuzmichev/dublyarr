import { and, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { notificationDeliveries, notifications, releases, users } from './db/schema';
import { can } from './auth/permissions';
import { getSetting, setSetting } from './settings';
import type { Telegram } from './telegram';
import { answerMatch } from './manual-search';
import { ruleFor } from './release-rules';
import { enqueue } from '../worker/jobs';
import { logger } from './log';

const log = logger('telegram');

// Входящие из Telegram: ответ на /start (Telegram ID для «Моего чата») и ответы кнопками «Это он» / «Не тот сериал».

/** Чат учётки (Telegram ID вписывается в «Мой чат»; бот присылает его в ответ на /start). Один чат — одна учётка: у прежнего владельца отвязывается. */
export function setUserChat(db: Db, userId: number, raw: string): { ok: true } | { error: string } {
  const chat = raw.trim();
  if (!/^-?\d{1,20}$/.test(chat)) return { error: 'Telegram ID — число' };
  db.update(users).set({ telegramChatId: null }).where(eq(users.telegramChatId, chat)).run();
  db.update(users).set({ telegramChatId: chat }).where(eq(users.id, userId)).run();
  return { ok: true };
}

export async function pollUpdates(db: Db, tg: Telegram, _now = Date.now()) {
  const res = { handled: 0 };
  let offset = getSetting<number>(db, 'telegram.offset') ?? 0;
  const updates = await tg.getUpdates(offset);
  for (const u of updates) {
    offset = Math.max(offset, u.update_id + 1);
    try {
      if (u.message?.text) await onMessage(db, tg, u.message.chat.id);
      if (u.callback_query) res.handled += await onButton(db, tg, u.callback_query);
    } catch (e) {
      log.warn({ update: u.update_id, err: e instanceof Error ? e.message : String(e) }, 'telegram update failed');
    }
  }
  setSetting(db, 'telegram.offset', offset);
  return res;
}

/** Любое сообщение боту (/start): непривязанному чату — его Telegram ID и куда вписать, привязанному — к какой учётке. */
async function onMessage(db: Db, tg: Telegram, chat: number) {
  const owner = db.select({ username: users.username }).from(users).where(eq(users.telegramChatId, String(chat))).get();
  await tg.sendMessage(
    String(chat),
    owner
      ? `Этот чат привязан к учётке «${owner.username}» — сюда приходят уведомления Dublyarr.`
      : `Ваш Telegram ID: ${chat}\nВпишите его в Dublyarr: Настройки → Уведомления → Мой чат.`,
  );
}

const ANSWER = { m: '✓ Это он', r: '✗ Не тот сериал' } as const;

async function onButton(db: Db, tg: Telegram, q: NonNullable<import('./telegram').TgUpdate['callback_query']>): Promise<number> {
  const chat = q.message?.chat.id;
  if (chat === undefined) return 0;
  const chatId = String(chat);
  const user = db.select().from(users).where(eq(users.telegramChatId, chatId)).get();
  if (!user) return 0; // только привязанные чаты
  if (!can(user, 'answer')) {
    await tg.answerCallback(q.id, 'Недостаточно прав');
    return 0;
  }
  const m = /^([mr]):(\d+)$/.exec(q.data ?? '');
  if (!m) return 0;
  const kind = m[1] as 'm' | 'r';
  const r = db.select().from(releases).where(eq(releases.id, Number(m[2]))).get();
  const delivery = q.message
    ? db.select().from(notificationDeliveries).where(and(eq(notificationDeliveries.chatId, chatId), eq(notificationDeliveries.messageId, q.message.message_id))).get()
    : undefined;
  const note = delivery ? db.select().from(notifications).where(eq(notifications.id, delivery.notificationId)).get() : undefined;
  if (!r) {
    await tg.answerCallback(q.id, 'Раздачи уже нет');
    return 0;
  }
  if (ruleFor(db, r.titleId, r.trackerName, r.title)) {
    await tg.answerCallback(q.id, 'Уже решено');
    return 0;
  }
  answerMatch(db, r.titleId, r.id, kind === 'm' ? 'match' : 'reject', 'telegram');
  enqueue(db, 'subscriptions.search');
  if (note) db.update(notifications).set({ answer: kind === 'm' ? 'match' : 'reject' }).where(eq(notifications.id, note.id)).run();
  await tg.answerCallback(q.id, 'Отмечено');
  if (q.message) await tg.editMessage(chatId, q.message.message_id, `${note?.text ?? r.title}\n${ANSWER[kind]}`);
  return 1;
}
