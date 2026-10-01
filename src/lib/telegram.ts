import type { Db } from './db/client';
import { setSecretSetting, tryGetSecretSetting } from './settings';
import { getTmdbSettings, proxiedFetch } from './tmdb';

// Клиент Telegram Bot API (spec §12). Токен — часть адреса запроса, поэтому адреса и тексты ошибок маскируются.

export type TelegramSettings = { token: string; chatId?: string; proxy?: string; baseUrl?: string };
export type InlineButton = { text: string; data?: string; url?: string };
export type TgUpdate = {
  update_id: number;
  message?: { message_id: number; chat: { id: number; title?: string; username?: string; first_name?: string }; text?: string };
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number } } };
};

export class TelegramError extends Error {
  constructor(
    message: string,
    public code: 'network' | 'auth' | 'blocked' | 'rate' | 'http',
    public retryAfter?: number,
  ) {
    super(message);
  }
}

// Токен в адресе («/bot<токен>/») заменяется звёздочками в любом тексте.
export const maskToken = (text: string) => text.replace(/\/bot[^/\s]+\//g, '/bot***/');

export const getTelegramSettings = (db: Db) => tryGetSecretSetting<TelegramSettings>(db, 'telegram');
export const saveTelegramSettings = (db: Db, s: TelegramSettings) => setSecretSetting(db, 'telegram', s);

/** Прокси: свой, иначе прокси TMDB (если задан). */
export const telegramProxy = (db: Db, s?: TelegramSettings) => s?.proxy || getTmdbSettings(db)?.proxy || undefined;

export function createTelegram(s: Pick<TelegramSettings, 'token' | 'proxy'>, opts: { fetchImpl?: typeof fetch; base?: string } = {}) {
  const fetchImpl = opts.fetchImpl ?? proxiedFetch(s.proxy);
  const base = (opts.base ?? process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org').replace(/\/+$/, '');

  async function call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}/bot${s.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new TelegramError(`Telegram недоступен — проверьте прокси (${maskToken(e instanceof Error ? e.message : String(e))})`, 'network');
    }
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };
    if (data.ok) return data.result as T;
    const status = data.error_code ?? res.status;
    if (status === 401 || status === 404) throw new TelegramError('Неверный токен бота', 'auth');
    if (status === 403) throw new TelegramError('Бот заблокирован в чате', 'blocked');
    if (status === 429) throw new TelegramError('Telegram просит подождать', 'rate', data.parameters?.retry_after ?? 30);
    throw new TelegramError(`Telegram ответил ошибкой ${status}: ${maskToken(data.description ?? '')}`, 'http');
  }

  const keyboard = (buttons: InlineButton[][]) => ({
    inline_keyboard: buttons.map((row) => row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data ?? '' }))),
  });

  return {
    getMe: async () => ({ username: (await call<{ username: string }>('getMe')).username }),
    async sendMessage(chatId: string, text: string, buttons?: InlineButton[][]) {
      const r = await call<{ message_id: number }>('sendMessage', { chat_id: chatId, text, ...(buttons?.length ? { reply_markup: keyboard(buttons) } : {}) });
      return { messageId: r.message_id };
    },
    async editMessage(chatId: string, messageId: number, text: string) {
      await call('editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: { inline_keyboard: [] } });
    },
    async answerCallback(id: string, text: string) {
      await call('answerCallbackQuery', { callback_query_id: id, text });
    },
    getUpdates: (offset: number) => call<TgUpdate[]>('getUpdates', { offset, timeout: 0, allowed_updates: ['message', 'callback_query'] }),
  };
}
export type Telegram = ReturnType<typeof createTelegram>;
