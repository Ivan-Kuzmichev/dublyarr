import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { totpAt, currentStep } from '../../src/lib/auth/totp';

test('первый запуск → 2FA → выход → вход с кодом → доверенное устройство', async ({ page, context }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel('Логин').fill('admin');
  await page.getByLabel('Пароль', { exact: true }).fill('очень-длинный-пароль');
  await page.getByLabel('Повторите пароль').fill('очень-длинный-пароль');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/setup\/tmdb$/);
  await page.getByRole('button', { name: 'Пропустить' }).click(); // TMDB
  await expect(page).toHaveURL(/\/setup\/qbittorrent$/);
  await page.getByRole('button', { name: 'Пропустить' }).click(); // qBittorrent
  await expect(page).toHaveURL(/\/setup\/sources$/);
  await page.getByRole('button', { name: 'Пропустить' }).click(); // источники
  await expect(page).toHaveURL(/\/setup\/folders$/);
  await page.getByLabel('Загрузки (куда качает qBittorrent)').fill(process.env.E2E_DIR!);
  await page.getByLabel('Медиатека (где смотрит VidHub)').fill(process.env.E2E_DIR!);
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible();

  await page.goto('/settings/security');
  await page.getByRole('button', { name: 'Включить' }).click();
  const secret = (await page.getByTestId('totp-secret').innerText()).replace(/\s/g, '');
  writeFileSync(path.join(process.env.E2E_DIR!, 'totp-secret'), secret); // для следующих сценариев
  await page.getByLabel('Код из приложения').fill(totpAt(secret, currentStep(Date.now())));
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Включена')).toBeVisible();

  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('Логин').fill('admin');
  await page.getByLabel('Пароль', { exact: true }).fill('очень-длинный-пароль');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Код подтверждения' })).toBeVisible();
  await page.getByLabel('Не спрашивать на этом устройстве 30 дней').check();
  // следующий шаг, чтобы не упереться в защиту от повтора кода из шага включения;
  // шестая цифра отправляет форму сама
  await page.getByLabel('Код из приложения').fill(totpAt(secret, currentStep(Date.now()) + 1));
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible();

  await context.clearCookies({ name: 'dy_session' });
  await page.goto('/login');
  await page.getByLabel('Логин').fill('admin');
  await page.getByLabel('Пароль', { exact: true }).fill('очень-длинный-пароль');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible(); // без кода

  // /setup после завершения мастера — на главную; без сеанса — на вход
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/$/);
  await context.clearCookies();
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/login$/);
});
