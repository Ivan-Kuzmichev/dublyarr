'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession, DENIED, guard } from '@/lib/auth/current';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getTelegramSettings, applyTelegramForm, createTelegram, telegramProxy, TelegramError } from '@/lib/telegram';
import { setUserChat } from '@/lib/telegram-updates';
import { parseEventsForm } from '@/lib/notify';
import { formValues } from '@/lib/form-values';

export type TgState = { ok?: string; error?: string; values?: Record<string, string> };

const errText = (e: unknown) => (e instanceof TelegramError ? e.message : 'Не удалось связаться с Telegram');

/** Бот (только админ): «Сохранить», «Проверить». Чаты — у каждой учётки свои (myChatAction). */
export async function telegramAction(_prev: TgState, form: FormData): Promise<TgState> {
  if (!(await guard('admin'))) return { error: DENIED };
  const db = getDb();
  const values = formValues(form, ['proxy', 'baseUrl']);
  const r = applyTelegramForm(db, { token: String(form.get('token') ?? ''), chatId: '', proxy: values.proxy, baseUrl: values.baseUrl });
  if ('error' in r) return { values, error: r.error };
  revalidatePath('/settings/notifications');
  if (form.get('intent') !== 'check') return { values, ok: 'Сохранено' };
  try {
    const tg = createTelegram({ token: r.settings.token, proxy: telegramProxy(db, r.settings) });
    const me = await tg.getMe();
    const at = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ });
    return { values, ok: `Связь есть: бот @${me.username} отвечает · проверено в ${at}` };
  } catch (e) {
    return { values, error: errText(e) };
  }
}

/** Свой чат: «Сохранить ID», «Отправить тестовое», «Отвязать». */
export async function myChatAction(_prev: TgState, form: FormData): Promise<TgState> {
  const { user } = await requireSession();
  const db = getDb();
  const s = getTelegramSettings(db);
  if (!s?.token) return { error: 'Бот ещё не настроен — попросите администратора' };
  const intent = form.get('intent');
  if (intent === 'set') {
    const r = setUserChat(db, user.id, String(form.get('chatId') ?? ''));
    if ('error' in r) return { error: r.error };
    revalidatePath('/settings/notifications');
    return { ok: 'Сохранено — нажмите «Отправить тестовое», чтобы проверить' };
  }
  if (intent === 'unpair') {
    db.update(users).set({ telegramChatId: null }).where(eq(users.id, user.id)).run();
    revalidatePath('/settings/notifications');
    return { ok: 'Чат отвязан' };
  }
  try {
    const tg = createTelegram({ token: s.token, proxy: telegramProxy(db, s) });
    if (intent === 'test') {
      const chat = db.select({ c: users.telegramChatId }).from(users).where(eq(users.id, user.id)).get()?.c;
      if (!chat) return { error: 'Сначала привяжите чат' };
      await tg.sendMessage(chat, 'Проверка связи: Dublyarr на месте ✓');
      return { ok: 'Тестовое сообщение доставлено' };
    }
    return { error: 'Неизвестное действие' };
  } catch (e) {
    return { error: errText(e) };
  }
}

/** Свои события. */
export async function saveEventsAction(_prev: TgState, form: FormData): Promise<TgState> {
  const { user } = await requireSession();
  getDb().update(users).set({ notifyEvents: parseEventsForm(form) }).where(eq(users.id, user.id)).run();
  revalidatePath('/settings/notifications');
  return { ok: 'Сохранено' };
}
