'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { setSetting } from '@/lib/settings';
import { createTelegram, getTelegramSettings, saveTelegramSettings, telegramProxy, TelegramError, type TelegramSettings } from '@/lib/telegram';
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
  const saved = getTelegramSettings(db);
  const token = String(form.get('token') ?? '').trim() || saved?.token || '';
  const proxy = values.proxy.trim();
  const baseUrl = values.baseUrl.trim().replace(/\/+$/, '');
  const chatId = values.chatId.trim();
  if (!token) return { values, error: 'Укажите токен бота (его выдаёт @BotFather)' };
  if (!/^\d+:[\w-]{20,}$/.test(token)) return { values, error: 'Токен вида 123456:ABC…' };
  if (proxy && !URL.canParse(proxy)) return { values, error: 'Прокси — адрес вида http://host:port' };
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) return { values, error: 'Адрес Dublyarr — вида http://nas:3000' };
  if (chatId && !/^-?\d+$/.test(chatId)) return { values, error: 'Chat ID — число' };
  const s: TelegramSettings = { token, ...(chatId ? { chatId } : {}), ...(proxy ? { proxy } : {}), ...(baseUrl ? { baseUrl } : {}) };
  const tg = createTelegram({ token, proxy: telegramProxy(db, s) });
  const intent = form.get('intent');
  try {
    // проверка тоже сохраняет: поле токена после действия очищается, а в браузер он не возвращается
    const me = intent === 'check' || intent === 'pair' ? await tg.getMe() : null;
    saveTelegramSettings(db, s);
    if (intent === 'check') return { values, ok: `Бот @${me!.username} · сохранено` };
    revalidatePath('/settings/notifications');
    if (intent === 'pair') return { values, ok: `Отправьте этот код боту @${me!.username} в течение 10 минут`, code: startPairing(db) };
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
