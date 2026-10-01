'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { setSetting } from '@/lib/settings';
import { applyTelegramForm, createTelegram, telegramProxy, TelegramError } from '@/lib/telegram';
import { startPairing } from '@/lib/telegram-updates';
import { parseEventsForm } from '@/lib/notify';
import { formValues } from '@/lib/form-values';

export type TgState = { ok?: string; error?: string; code?: string; values?: Record<string, string> };

const errText = (e: unknown) => (e instanceof TelegramError ? e.message : 'Не удалось связаться с Telegram');

/** Одна форма бота: «Сохранить», «Проверить», «Привязать чат», «Отправить тестовое». */
export async function telegramAction(_prev: TgState, form: FormData): Promise<TgState> {
  await requireSession();
  const db = getDb();
  const values = formValues(form, ['proxy', 'baseUrl', 'chatId']);
  const intent = form.get('intent');
  const r = applyTelegramForm(db, { token: String(form.get('token') ?? ''), chatId: values.chatId, proxy: values.proxy, baseUrl: values.baseUrl, unpair: intent === 'unpair' });
  if ('error' in r) return { values, error: r.error };
  revalidatePath('/settings/notifications');
  if (intent === 'unpair') return { values: { ...values, chatId: '' }, ok: 'Чат отвязан' };
  const s = r.settings;
  try {
    const tg = createTelegram({ token: s.token, proxy: telegramProxy(db, s) });
    if (intent === 'check') return { values, ok: `Бот @${(await tg.getMe()).username} · сохранено` };
    if (intent === 'pair') return { values, ok: `Отправьте этот код боту @${(await tg.getMe()).username} в течение 10 минут`, code: startPairing(db) };
    if (intent === 'test') {
      if (!s.chatId) return { values, error: 'Сначала привяжите чат' };
      await tg.sendMessage(s.chatId, 'Проверка связи: Dublyarr на месте ✓');
      return { values, ok: 'Тестовое сообщение доставлено' };
    }
    return { values, ok: 'Сохранено' };
  } catch (e) {
    return { values, error: errText(e) };
  }
}

export async function saveEventsAction(_prev: TgState, form: FormData): Promise<TgState> {
  await requireSession();
  setSetting(getDb(), 'telegram.events', parseEventsForm(form));
  revalidatePath('/settings/notifications');
  return { ok: 'Сохранено' };
}
