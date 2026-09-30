import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { totpAt, currentStep } from '../../src/lib/auth/totp';

test('ключ TMDB в настройках → тренды → поиск → карточка → смена типа', async ({ page }) => {
  const secret = readFileSync(path.join(process.env.E2E_DIR!, 'totp-secret'), 'utf8');
  await page.goto('/login');
  await page.getByLabel('Логин').fill('admin');
  await page.getByLabel('Пароль', { exact: true }).fill('очень-длинный-пароль');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Код подтверждения' })).toBeVisible();
  // Сценарий 01 использовал коды вплоть до «текущий шаг + 1». Ждём новое 30-секундное окно
  // и берём код следующего шага: он новее всех использованных и ещё в допустимом окне ±1.
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
  await page.getByLabel('Код из приложения').fill(totpAt(secret, currentStep(Date.now()) + 1));
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible();

  await page.goto('/discover');
  await expect(page.getByText('Добавьте ключ TMDB')).toBeVisible();
  await page.goto('/settings/sources');
  await page.getByLabel('Ключ API').fill('bad');
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(page.getByText('Неверный ключ TMDB')).toBeVisible();
  await page.getByLabel('Ключ API').fill('ok');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Сохранено · TMDB отвечает')).toBeVisible();

  await page.goto('/discover');
  await expect(page.getByRole('heading', { name: 'Популярное за неделю' })).toBeVisible();
  await page.getByPlaceholder('Название сериала').fill('атака');
  await expect(page.getByText('Найдено: 1')).toBeVisible();
  await expect(page).toHaveURL(/q=/);
  await page.getByRole('link', { name: /Атака титанов/ }).click();
  await expect(page.getByRole('heading', { name: 'Атака титанов', level: 1 })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Аниме' })).toBeChecked();

  await page.goto('/series/1399');
  await expect(page.getByText('Зима близко')).toBeVisible();
  await page.getByText('Аниме', { exact: true }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Аниме' })).toBeChecked({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  const img = await page.request.get('/api/image/w342/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg');
  expect(img.status()).toBe(200);
  expect((await page.request.get('/api/image/w342/..%2Fsecret.key')).status()).toBeGreaterThanOrEqual(400);
});
