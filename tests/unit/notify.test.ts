import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { DEFAULT_EVENTS, notify, sendPending } from '@/lib/notify';
import { TelegramError, type Telegram } from '@/lib/telegram';
import { notificationDeliveries, notifications, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const MIN = 60_000;
type Db = ReturnType<typeof testDb>;
/** Получатель: учётка с привязанным чатом. */
function person(db: Db, username: string, chat: string | null, o: { role?: 'admin' | 'user'; permissions?: Record<string, boolean>; events?: Record<string, boolean> } = {}) {
  return db.insert(users).values({ username, passwordHash: 'x', role: o.role ?? 'admin', permissions: o.permissions ?? {}, telegramChatId: chat, notifyEvents: o.events ?? null, createdAt: 1, updatedAt: 1 }).returning().get();
}
const deliveries = (db: Db) => db.select().from(notificationDeliveries).all();

function fakeTg(fail?: () => Error | null) {
  const sent: { chatId: string; text: string; buttons?: unknown }[] = [];
  const tg = {
    async sendMessage(chatId: string, text: string, buttons?: unknown) {
      const e = fail?.();
      if (e) throw e;
      sent.push({ chatId, text, buttons });
      return { messageId: sent.length };
    },
  } as unknown as Telegram;
  return { tg, sent };
}

test('события по умолчанию; никто не ждёт — не пишется; один ключ — одна запись', () => {
  const db = testDb();
  const admin = person(db, 'admin', '42');
  expect(DEFAULT_EVENTS).toEqual({ downloaded: true, stuck: true, ask: true, original: false, 'source-down': true });
  expect(notify(db, { key: 'w:1', kind: 'original', text: 'x' }, 1)).toBe(false);
  expect(notify(db, { key: 'import:1', kind: 'downloaded', text: 'x' }, 1)).toBe(true);
  expect(notify(db, { key: 'import:1', kind: 'downloaded', text: 'x' }, 2)).toBe(false);
  db.update(users).set({ notifyEvents: { ...DEFAULT_EVENTS, original: true } }).where(eq(users.id, admin.id)).run();
  expect(notify(db, { key: 'w:1', kind: 'original', text: 'x' }, 3)).toBe(true);
  expect(db.select().from(notifications).all()).toHaveLength(2);
});

test('получатели: свой чат и свои события; вопросы — только с правом ответа; выключенные и без чата — нет', () => {
  const db = testDb();
  const admin = person(db, 'admin', '1');
  const anya = person(db, 'anya', '2', { role: 'user', permissions: { subscribe: true } });
  const boris = person(db, 'boris', '3', { role: 'user', permissions: { answer: true }, events: { ...DEFAULT_EVENTS, downloaded: false } });
  person(db, 'nochat', null);
  db.insert(users).values({ username: 'off', passwordHash: 'x', telegramChatId: '9', disabled: true, createdAt: 1, updatedAt: 1 }).run();
  notify(db, { key: 'imp', kind: 'downloaded', text: 'x' }, 1);
  notify(db, { key: 'ask', kind: 'ask', text: 'q', buttons: [[{ text: 'Это он', data: 'm:1' }]] }, 1);
  const by = (key: string) => {
    const n = db.select().from(notifications).where(eq(notifications.key, key)).get()!;
    return deliveries(db).filter((d) => d.notificationId === n.id).map((d) => d.userId).sort();
  };
  expect(by('imp')).toEqual([admin.id, anya.id]);
  expect(by('ask')).toEqual([admin.id, boris.id]);
});

test('отправка и повторы с растущей паузой; через сутки — «не доставлено»', async () => {
  const db = testDb();
  person(db, 'admin', '42');
  notify(db, { key: 'a', kind: 'downloaded', text: 'A', buttons: [[{ text: 'Открыть', url: 'http://x' }]] }, 0);
  let down = true;
  const { tg, sent } = fakeTg(() => (down ? new TelegramError('Telegram недоступен', 'network') : null));
  expect(await sendPending(db, tg, 0)).toEqual({ sent: 0, failed: 1 });
  expect(deliveries(db)[0]).toMatchObject({ attempts: 1, nextAt: 2 * MIN, sentAt: null });
  expect(await sendPending(db, tg, MIN)).toEqual({ sent: 0, failed: 0 }); // рано
  await sendPending(db, tg, 2 * MIN);
  expect(deliveries(db)[0]).toMatchObject({ attempts: 2, nextAt: 6 * MIN });
  down = false;
  expect(await sendPending(db, tg, 6 * MIN)).toEqual({ sent: 1, failed: 0 });
  expect(sent).toEqual([{ chatId: '42', text: 'A', buttons: [[{ text: 'Открыть', url: 'http://x' }]] }]);
  expect(deliveries(db)[0]).toMatchObject({ sentAt: 6 * MIN, messageId: 1 });

  notify(db, { key: 'b', kind: 'downloaded', text: 'B' }, 0);
  down = true;
  await sendPending(db, tg, 25 * 60 * MIN);
  expect(deliveries(db)[1]).toMatchObject({ error: 'не доставлено', sentAt: null });
});

test('лимит Telegram — ждать retry_after; бот заблокирован — без повторов', async () => {
  const db = testDb();
  person(db, 'admin', '42');
  notify(db, { key: 'a', kind: 'downloaded', text: 'A' }, 0);
  notify(db, { key: 'b', kind: 'downloaded', text: 'B' }, 0);
  const { tg } = fakeTg(() => new TelegramError('подождите', 'rate', 30));
  await sendPending(db, tg, 0);
  const rows = deliveries(db);
  expect(rows[0]).toMatchObject({ nextAt: 30_000 });
  expect(rows[1]).toMatchObject({ attempts: 0 }); // после лимита дальше не шлём
  const blocked = fakeTg(() => new TelegramError('Бот заблокирован в чате', 'blocked'));
  await sendPending(db, blocked.tg, 60_000);
  expect(deliveries(db).every((d) => d.error === 'Бот заблокирован в чате')).toBe(true);
});

test('разбор формы событий', async () => {
  const { parseEventsForm } = await import('@/lib/notify');
  const f = new FormData();
  f.set('downloaded', 'on');
  f.set('original', 'on');
  expect(parseEventsForm(f)).toEqual({ downloaded: true, stuck: false, ask: false, original: true, 'source-down': false });
});

test('Telegram недоступен — после первой ошибки сети проход прекращается (не ждём таймаут на каждом)', async () => {
  const db = testDb();
  person(db, 'admin', '42');
  for (const k of ['a', 'b', 'c']) notify(db, { key: k, kind: 'downloaded', text: k }, 0);
  let calls = 0;
  const { tg } = fakeTg(() => {
    calls++;
    return new TelegramError('Telegram недоступен', 'network');
  });
  await sendPending(db, tg, 0);
  expect(calls).toBe(1);
});

test('повтор у одного получателя не дублирует другому', async () => {
  const db = testDb();
  person(db, 'admin', '1');
  person(db, 'anya', '2', { role: 'user', permissions: {} });
  notify(db, { key: 'a', kind: 'downloaded', text: 'A' }, 0);
  const { tg, sent } = fakeTg(() => null);
  let failed = false;
  const failOnce = { ...tg, sendMessage: async (chat: string, text: string) => (chat === '2' && !failed ? ((failed = true), Promise.reject(new TelegramError('x', 'http'))) : tg.sendMessage(chat, text)) } as unknown as Telegram;
  await sendPending(db, failOnce, 0);
  expect(sent.map((x) => x.chatId)).toEqual(['1']);
  await sendPending(db, failOnce, 3 * MIN);
  expect(sent.map((x) => x.chatId)).toEqual(['1', '2']);
});
