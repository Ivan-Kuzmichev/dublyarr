import { randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { notifications, releases } from './db/schema';
import { getSetting, setSetting } from './settings';
import { getTelegramSettings, saveTelegramSettings, type Telegram } from './telegram';
import { answerMatch } from './manual-search';
import { ruleFor } from './release-rules';
import { enqueue } from '../worker/jobs';
import { log } from './log';

// Входящие из Telegram: привязка чата кодом и ответы кнопками «Это он» / «Не тот сериал».

const PAIR_TTL = 10 * 60_000;

/** Одноразовый код из 6 цифр: пользователь отправляет его боту, и чат привязывается. */
export function startPairing(db: Db, now = Date.now()): string {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  setSetting(db, 'telegram.pairing', { code, startedAt: now, expires: now + PAIR_TTL, wrong: 0 });
  return code;
}

export async function pollUpdates(db: Db, tg: Telegram, now = Date.now()) {
  const res = { handled: 0 };
  let offset = getSetting<number>(db, 'telegram.offset') ?? 0;
  const updates = await tg.getUpdates(offset);
  for (const u of updates) {
    offset = Math.max(offset, u.update_id + 1);
    try {
      if (u.message?.text) await onMessage(db, tg, u.message.chat.id, u.message.text, now, (u.message as { date?: number }).date);
      if (u.callback_query) res.handled += await onButton(db, tg, u.callback_query);
    } catch (e) {
      log.warn({ update: u.update_id, err: e instanceof Error ? e.message : String(e) }, 'telegram update failed');
    }
  }
  setSetting(db, 'telegram.offset', offset);
  return res;
}

const MAX_WRONG = 5;

async function onMessage(db: Db, tg: Telegram, chat: number, text: string, now: number, date?: number) {
  const pairing = getSetting<{ code: string; startedAt: number; expires: number; wrong: number }>(db, 'telegram.pairing');
  if (!pairing || now > pairing.expires) return;
  // отправленное до выдачи кода не считается; подбор — после 5 неверных код сгорает
  if (date !== undefined && date * 1000 < pairing.startedAt) return;
  const guess = text.trim();
  if (guess !== pairing.code) {
    if (!/^\d{6}$/.test(guess)) return;
    const wrong = (pairing.wrong ?? 0) + 1;
    setSetting(db, 'telegram.pairing', wrong >= MAX_WRONG ? null : { ...pairing, wrong });
    return;
  }
  const s = getTelegramSettings(db);
  if (!s) return;
  saveTelegramSettings(db, { ...s, chatId: String(chat) });
  setSetting(db, 'telegram.pairing', null);
  await tg.sendMessage(String(chat), 'Чат привязан — сюда будут приходить уведомления Dublyarr');
}

const ANSWER = { m: '✓ Это он', r: '✗ Не тот сериал' } as const;

async function onButton(db: Db, tg: Telegram, q: NonNullable<import('./telegram').TgUpdate['callback_query']>): Promise<number> {
  const chatId = getTelegramSettings(db)?.chatId;
  const chat = q.message?.chat.id;
  if (!chatId || chat === undefined || String(chat) !== chatId) return 0; // только привязанный чат
  const m = /^([mr]):(\d+)$/.exec(q.data ?? '');
  if (!m) return 0;
  const kind = m[1] as 'm' | 'r';
  const r = db.select().from(releases).where(eq(releases.id, Number(m[2]))).get();
  const note = q.message ? db.select().from(notifications).where(eq(notifications.messageId, q.message.message_id)).get() : undefined;
  if (!r) {
    await tg.answerCallback(q.id, 'Раздачи уже нет');
    return 0;
  }
  if (ruleFor(db, r.titleId, r.trackerName, r.title)) {
    await tg.answerCallback(q.id, 'Уже решено');
    return 0;
  }
  answerMatch(db, r.titleId, r.id, kind === 'm' ? 'match' : 'reject');
  enqueue(db, 'subscriptions.search');
  if (note) db.update(notifications).set({ answer: kind === 'm' ? 'match' : 'reject' }).where(eq(notifications.id, note.id)).run();
  await tg.answerCallback(q.id, 'Отмечено');
  if (q.message) await tg.editMessage(chatId, q.message.message_id, `${note?.text ?? r.title}\n${ANSWER[kind]}`);
  return 1;
}
