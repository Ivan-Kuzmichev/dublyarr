import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { totpAt, currentStep } from '../../src/lib/auth/totp';

/**
 * Вход с кодом в новом браузерном контексте. Предыдущие сценарии уже использовали коды вплоть до
 * «текущий шаг + 1», поэтому ждём новое 30-секундное окно и берём код следующего шага.
 */
export async function loginWithCode(page: Page) {
  const secret = readFileSync(path.join(process.env.E2E_DIR!, 'totp-secret'), 'utf8');
  await page.goto('/login');
  await page.getByLabel('Логин').fill('admin');
  await page.getByLabel('Пароль', { exact: true }).fill('очень-длинный-пароль');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Код подтверждения' })).toBeVisible();
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
  await page.getByLabel('Код из приложения').fill(totpAt(secret, currentStep(Date.now()) + 1));
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible();
}
