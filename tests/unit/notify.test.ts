import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { DEFAULT_EVENTS, notify, sendPending } from '@/lib/notify';
import { TelegramError, type Telegram } from '@/lib/telegram';
import { notifications } from '@/lib/db/schema';
import { setSetting } from '@/lib/settings';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const MIN = 60_000;

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

test('события по умолчанию; выключенное не пишется; один ключ — одна запись', () => {
  const db = testDb();
  expect(DEFAULT_EVENTS).toEqual({ downloaded: true, stuck: true, ask: true, original: false, 'source-down': true });
  expect(notify(db, { key: 'w:1', kind: 'original', text: 'x' }, 1)).toBe(false);
  expect(notify(db, { key: 'import:1', kind: 'downloaded', text: 'x' }, 1)).toBe(true);
  expect(notify(db, { key: 'import:1', kind: 'downloaded', text: 'x' }, 2)).toBe(false);
  setSetting(db, 'telegram.events', { ...DEFAULT_EVENTS, original: true });
  expect(notify(db, { key: 'w:1', kind: 'original', text: 'x' }, 3)).toBe(true);
  expect(db.select().from(notifications).all()).toHaveLength(2);
});

test('отправка и повторы с растущей паузой; через сутки — «не доставлено»', async () => {
  const db = testDb();
  notify(db, { key: 'a', kind: 'downloaded', text: 'A', buttons: [[{ text: 'Открыть', url: 'http://x' }]] }, 0);
  let down = true;
  const { tg, sent } = fakeTg(() => (down ? new TelegramError('Telegram недоступен', 'network') : null));
  expect(await sendPending(db, tg, '42', 0)).toEqual({ sent: 0, failed: 1 });
  expect(db.select().from(notifications).get()).toMatchObject({ attempts: 1, nextAt: 2 * MIN, sentAt: null });
  expect(await sendPending(db, tg, '42', MIN)).toEqual({ sent: 0, failed: 0 }); // рано
  await sendPending(db, tg, '42', 2 * MIN);
  expect(db.select().from(notifications).get()).toMatchObject({ attempts: 2, nextAt: 6 * MIN });
  down = false;
  expect(await sendPending(db, tg, '42', 6 * MIN)).toEqual({ sent: 1, failed: 0 });
  expect(sent).toEqual([{ chatId: '42', text: 'A', buttons: [[{ text: 'Открыть', url: 'http://x' }]] }]);
  expect(db.select().from(notifications).get()).toMatchObject({ sentAt: 6 * MIN, messageId: 1 });

  notify(db, { key: 'b', kind: 'downloaded', text: 'B' }, 0);
  down = true;
  await sendPending(db, tg, '42', 25 * 60 * MIN);
  expect(db.select().from(notifications).all().find((n) => n.key === 'b')).toMatchObject({ error: 'не доставлено', sentAt: null });
});

test('лимит Telegram — ждать retry_after; бот заблокирован — без повторов', async () => {
  const db = testDb();
  notify(db, { key: 'a', kind: 'downloaded', text: 'A' }, 0);
  notify(db, { key: 'b', kind: 'downloaded', text: 'B' }, 0);
  const { tg } = fakeTg(() => new TelegramError('подождите', 'rate', 30));
  await sendPending(db, tg, '42', 0);
  const rows = db.select().from(notifications).all();
  expect(rows[0]).toMatchObject({ nextAt: 30_000 });
  expect(rows[1]).toMatchObject({ attempts: 0 }); // после лимита дальше не шлём
  const blocked = fakeTg(() => new TelegramError('Бот заблокирован в чате', 'blocked'));
  await sendPending(db, blocked.tg, '42', 60_000);
  expect(db.select().from(notifications).all().every((n) => n.error === 'Бот заблокирован в чате')).toBe(true);
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
  for (const k of ['a', 'b', 'c']) notify(db, { key: k, kind: 'downloaded', text: k }, 0);
  let calls = 0;
  const { tg } = fakeTg(() => {
    calls++;
    return new TelegramError('Telegram недоступен', 'network');
  });
  await sendPending(db, tg, '42', 0);
  expect(calls).toBe(1);
});
