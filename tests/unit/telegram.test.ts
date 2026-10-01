import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createTelegram, maskToken, TelegramError } from '@/lib/telegram';

process.env.DUBLYARR_SECRET_KEY ??= randomBytes(32).toString('base64');

const TOKEN = '123456:SECRET-token_x';
function fake(handler: (method: string, body: Record<string, unknown>) => Response | Promise<Response>) {
  const log: { url: string; method: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = String(url).split('/').pop()!;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    log.push({ url: String(url), method, body });
    return handler(method, body);
  }) as unknown as typeof fetch;
  return { log, fetchImpl };
}
const ok = (result: unknown) => Response.json({ ok: true, result });

test('отправка с кнопками, правка, ответ на нажатие, обновления', async () => {
  const f = fake((m) => (m === 'sendMessage' ? ok({ message_id: 7 }) : m === 'getMe' ? ok({ username: 'dy_bot' }) : m === 'getUpdates' ? ok([{ update_id: 5 }]) : ok(true)));
  const tg = createTelegram({ token: TOKEN }, { fetchImpl: f.fetchImpl, base: 'http://tg' });
  expect(await tg.getMe()).toEqual({ username: 'dy_bot' });
  expect(await tg.sendMessage('42', 'Привет', [[{ text: 'Это он', data: 'm:1' }, { text: 'Открыть', url: 'http://nas/x' }]])).toEqual({ messageId: 7 });
  expect(f.log[1]).toMatchObject({
    url: `http://tg/bot${TOKEN}/sendMessage`,
    body: { chat_id: '42', text: 'Привет', reply_markup: { inline_keyboard: [[{ text: 'Это он', callback_data: 'm:1' }, { text: 'Открыть', url: 'http://nas/x' }]] } },
  });
  await tg.editMessage('42', 7, 'Готово');
  expect(f.log[2]).toMatchObject({ method: 'editMessageText', body: { chat_id: '42', message_id: 7, text: 'Готово', reply_markup: { inline_keyboard: [] } } });
  await tg.answerCallback('cb1', 'Отмечено');
  expect(f.log[3]).toMatchObject({ method: 'answerCallbackQuery', body: { callback_query_id: 'cb1', text: 'Отмечено' } });
  expect(await tg.getUpdates(5)).toEqual([{ update_id: 5 }]);
  expect(f.log[4].body).toMatchObject({ offset: 5, timeout: 0 });
});

test('ошибки: токен, блокировка, лимит, сеть — без токена в тексте', async () => {
  const err = (status: number, extra: Record<string, unknown> = {}) => Response.json({ ok: false, error_code: status, description: 'x', ...extra }, { status });
  const call = async (r: () => Response | Promise<Response>) => {
    const tg = createTelegram({ token: TOKEN }, { fetchImpl: fake(r).fetchImpl, base: 'http://tg' });
    return tg.sendMessage('1', 'x').catch((e: unknown) => e as TelegramError);
  };
  expect(await call(() => err(401))).toMatchObject({ code: 'auth', message: 'Неверный токен бота' });
  expect(await call(() => err(403))).toMatchObject({ code: 'blocked', message: 'Бот заблокирован в чате' });
  expect(await call(() => err(429, { parameters: { retry_after: 30 } }))).toMatchObject({ code: 'rate', retryAfter: 30 });
  const net = await call(() => {
    throw new TypeError(`fetch failed: http://tg/bot${TOKEN}/sendMessage`);
  });
  expect(net).toMatchObject({ code: 'network' });
  expect((net as Error).message).toContain('Telegram недоступен');
  expect((net as Error).message).not.toContain('SECRET');
});

test('maskToken', () => {
  expect(maskToken(`GET https://api.telegram.org/bot${TOKEN}/getMe failed`)).toBe('GET https://api.telegram.org/bot***/getMe failed');
});

describe('форма бота', () => {
  const T = '123456:abcdefghijklmnopqrstuvwxyz';
  const T2 = '654321:zyxwvutsrqponmlkjihgfedcba';
  test('пустой Chat ID сохраняет привязанный; «отвязать» — снимает', async () => {
    const { testDb } = await import('./helpers');
    const { applyTelegramForm, saveTelegramSettings, getTelegramSettings } = await import('@/lib/telegram');
    const db = testDb();
    saveTelegramSettings(db, { token: T, chatId: '777' });
    expect(applyTelegramForm(db, { token: '', chatId: '', proxy: '', baseUrl: '' })).toMatchObject({ settings: { token: T, chatId: '777' } });
    expect(getTelegramSettings(db)!.chatId).toBe('777');
    applyTelegramForm(db, { token: '', chatId: '', proxy: '', baseUrl: '', unpair: true });
    expect(getTelegramSettings(db)!.chatId).toBeUndefined();
  });
  test('смена токена сбрасывает offset; прокси — только http(s)', async () => {
    const { testDb } = await import('./helpers');
    const { applyTelegramForm, saveTelegramSettings } = await import('@/lib/telegram');
    const { getSetting, setSetting } = await import('@/lib/settings');
    const db = testDb();
    saveTelegramSettings(db, { token: T });
    setSetting(db, 'telegram.offset', 500);
    applyTelegramForm(db, { token: T, chatId: '', proxy: '', baseUrl: '' });
    expect(getSetting(db, 'telegram.offset')).toBe(500);
    applyTelegramForm(db, { token: T2, chatId: '', proxy: '', baseUrl: '' });
    expect(getSetting(db, 'telegram.offset') ?? null).toBeNull();
    expect(applyTelegramForm(db, { token: '', chatId: '', proxy: 'socks5://h:1', baseUrl: '' })).toEqual({ error: 'Прокси — адрес вида http://host:port' });
  });
});
