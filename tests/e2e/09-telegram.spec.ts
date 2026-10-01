import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import { loginWithCode } from './helpers';

const TG = 'http://127.0.0.1:3196';
type Sent = { method: string; text?: string; chat_id?: string };

test('Telegram: привязка кодом → тестовое → «Не тот сериал» кнопкой', async ({ page, request }) => {
  test.setTimeout(240_000);
  const sent = async () => (await (await request.get(`${TG}/__sent`)).json()) as Sent[];
  await loginWithCode(page);

  await page.goto('/settings/notifications');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Telegram-бот' }) });
  await card.getByLabel('Токен бота').fill('123456:abcdefghijklmnopqrstuvwxyz');
  await card.getByRole('button', { name: 'Проверить' }).click();
  await expect(card.getByText('Бот @dublyarr_test_bot · сохранено')).toBeVisible();
  await card.getByRole('button', { name: 'Привязать чат' }).click();
  const code = (await card.locator('span.font-mono.text-\\[28px\\]').textContent())!.trim();
  expect(code).toMatch(/^\d{6}$/);
  await request.post(`${TG}/__push`, { data: { message: { message_id: 1, chat: { id: 4242, first_name: 'Иван' }, text: code } } });
  await expect(async () => {
    await page.reload();
    await expect(card.getByText('чат привязан')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });
  expect((await sent()).some((m) => m.text?.startsWith('Чат привязан'))).toBe(true);

  await card.getByRole('button', { name: 'Отправить тестовое' }).click();
  await expect(card.getByText('Тестовое сообщение доставлено')).toBeVisible();
  expect((await sent()).some((m) => m.method === 'sendMessage' && m.chat_id === '4242' && m.text?.startsWith('Проверка связи'))).toBe(true);

  // нажатие «Не тот сериал» по раздаче Kinozal (вопрос мог прийти и раньше — данные кнопки те же)
  const db = new Database(path.join(process.env.E2E_DIR!, 'data', 'db.sqlite'), { readonly: true });
  const rel = db.prepare("SELECT id FROM releases WHERE title LIKE '%Sub WEBDL 1080p%'").get() as { id: number };
  db.close();
  await request.post(`${TG}/__push`, { data: { callback_query: { id: 'cb1', data: `r:${rel.id}`, message: { message_id: 500, chat: { id: 4242 } } } } });
  await expect.poll(async () => (await sent()).some((m) => m.method === 'answerCallbackQuery'), { timeout: 60_000 }).toBe(true);

  await page.goto('/search/1399?s=1&e=1');
  await expect(page.locator('div.grid.border-t', { hasText: 'Sub WEBDL 1080p' })).toContainText('В чёрном списке');
});
