import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { pollUpdates, startPairing } from '@/lib/telegram-updates';
import { saveTelegramSettings, type Telegram, type TgUpdate } from '@/lib/telegram';
import { notificationDeliveries, notifications, releaseRules, releases, sources, titles, jobs, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getSetting } from '@/lib/settings';
import type { ParsedRelease } from '@/lib/parse/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const MIN = 60_000;

function setup() {
  const db = testDb();
  saveTelegramSettings(db, { token: 't' });
  const admin = db.insert(users).values({ username: 'admin', passwordHash: 'x', createdAt: 1, updatedAt: 1 }).returning().get();
  const anya = db.insert(users).values({ username: 'anya', passwordHash: 'x', role: 'user', permissions: { subscribe: true }, createdAt: 1, updatedAt: 1 }).returning().get();
  const calls: string[] = [];
  let queue: TgUpdate[] = [];
  const tg = {
    async getUpdates(offset: number) {
      calls.push(`get:${offset}`);
      const out = queue.filter((u) => u.update_id >= offset);
      queue = [];
      return out;
    },
    async sendMessage(chatId: string, text: string) {
      calls.push(`send:${chatId}:${text}`);
      return { messageId: 99 };
    },
    async answerCallback(_id: string, text: string) {
      calls.push(`answer:${text}`);
    },
    async editMessage(chatId: string, messageId: number, text: string) {
      calls.push(`edit:${chatId}:${messageId}:${text}`);
    },
  } as unknown as Telegram;
  const push = (...u: TgUpdate[]) => (queue = u);
  const chatOf = (id: number) => db.select().from(users).where(eq(users.id, id)).get()!.telegramChatId;
  return { db, tg, calls, push, admin, anya, chatOf };
}
const msg = (id: number, chat: number, text: string): TgUpdate => ({ update_id: id, message: { message_id: id, chat: { id: chat, first_name: 'Иван' }, text } });
const cb = (id: number, chat: number, data: string, messageId = 5): TgUpdate => ({ update_id: id, callback_query: { id: `cb${id}`, data, message: { message_id: messageId, chat: { id: chat } } } });

test('привязка чата кодом; неверный и просроченный код — нет', async () => {
  const { db, tg, calls, push, admin, anya, chatOf } = setup();
  const code = startPairing(db, admin.id, 0);
  expect(code).toMatch(/^\d{6}$/);
  push(msg(1, 555, '000000'));
  await pollUpdates(db, tg, MIN);
  expect(chatOf(admin.id)).toBeNull();
  push(msg(2, 777, code));
  await pollUpdates(db, tg, 11 * MIN); // код живёт 10 минут
  expect(chatOf(admin.id)).toBeNull();
  const fresh = startPairing(db, admin.id, 20 * MIN);
  push(msg(3, 777, ` ${fresh} `));
  await pollUpdates(db, tg, 21 * MIN);
  expect(chatOf(admin.id)).toBe('777');
  // тот же чат привязала Аня — у админа он отвязан (один чат — одна учётка)
  const hers = startPairing(db, anya.id, 30 * MIN);
  push(msg(4, 777, hers));
  await pollUpdates(db, tg, 31 * MIN);
  expect([chatOf(admin.id), chatOf(anya.id)]).toEqual([null, '777']);
  expect(calls).toContain('send:777:Чат привязан — сюда будут приходить уведомления Dublyarr');
  expect(getSetting(db, 'telegram.offset')).toBe(5);
});

function withQuestion() {
  const s = setup();
  s.db.update(users).set({ telegramChatId: '777' }).where(eq(users.id, s.admin.id)).run();
  s.db.update(users).set({ telegramChatId: '888' }).where(eq(users.id, s.anya.id)).run();
  const t = s.db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const src = s.db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const parsed = { base: 'x', names: ['a'], year: null, seasons: [1], episodes: null, totalInSeason: null, absolute: false, pack: true, resolution: 1080, source: null, hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false } as ParsedRelease;
  const r = s.db.insert(releases).values({ titleId: t.id, sourceId: src.id, trackerName: 'RuTracker', title: 'A S01 [странное]', size: 1, firstSeenAt: 1, lastSeenAt: 1, parsed, match: { score: 0.6, level: 'doubt', reasons: [] } }).returning().get();
  const n = s.db.insert(notifications).values({ key: 'ask:1', kind: 'ask', text: '❓ A · S01E01: вопрос', createdAt: 1, nextAt: 1, sentAt: 2, ref: { releaseId: r.id, titleId: t.id } }).returning().get();
  s.db.insert(notificationDeliveries).values({ notificationId: n.id, userId: s.admin.id, chatId: '777', nextAt: 1, sentAt: 2, messageId: 5 }).run();
  return { ...s, r, t };
}

test('«Не тот сериал» кнопкой — правило, поиск в очереди, сообщение исправлено', async () => {
  const { db, tg, calls, push, r } = withQuestion();
  push(cb(10, 777, `r:${r.id}`));
  expect(await pollUpdates(db, tg, 1)).toEqual({ handled: 1 });
  expect(db.select().from(releaseRules).all()).toEqual([expect.objectContaining({ verdict: 'reject', trackerName: 'RuTracker' })]);
  expect(db.select().from(jobs).all().map((j) => j.type)).toContain('subscriptions.search');
  expect(calls).toContain('answer:Отмечено');
  expect(calls).toContain('edit:777:5:❓ A · S01E01: вопрос\n✗ Не тот сериал');
});

test('нажатие из чужого чата и без права ответа — игнор; уже решено — правило не меняется', async () => {
  const { db, tg, calls, push, r } = withQuestion();
  push(cb(10, 666, `m:${r.id}`));
  await pollUpdates(db, tg, 1);
  push(cb(11, 888, `m:${r.id}`)); // Аня: нет права «ответы на вопросы»
  await pollUpdates(db, tg, 1);
  expect(db.select().from(releaseRules).all()).toEqual([]);
  expect(calls).toContain('answer:Недостаточно прав');
  push(cb(12, 777, `r:${r.id}`));
  await pollUpdates(db, tg, 2);
  push(cb(13, 777, `m:${r.id}`));
  await pollUpdates(db, tg, 3);
  expect(db.select().from(releaseRules).get()!.verdict).toBe('reject');
  expect(calls).toContain('answer:Уже решено');
});

test('привязка: старые сообщения и подбор кода не проходят', async () => {
  const { db, tg, push, admin, chatOf } = setup();
  const code = startPairing(db, admin.id, 100 * MIN);
  const at = (id: number, text: string, date: number): TgUpdate => ({ update_id: id, message: { message_id: id, chat: { id: 9 }, text, date } as never });
  push(at(1, code, (99 * MIN) / 1000)); // отправлено до выдачи кода
  await pollUpdates(db, tg, 101 * MIN);
  expect(chatOf(admin.id)).toBeNull();
  push(...[2, 3, 4, 5, 6].map((i) => at(i, String(100000 + i), (101 * MIN) / 1000)), at(7, code, (101 * MIN) / 1000));
  await pollUpdates(db, tg, 102 * MIN);
  expect(chatOf(admin.id)).toBeNull(); // после 5 неверных код сгорел
});
