import { test, expect } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loginWithCode } from './helpers';

test('«Хранилище» → удалить сериал «только файлы» → файлов нет, подписка на месте', async ({ page }) => {
  test.setTimeout(180_000);
  const show = path.join(process.env.E2E_DIR!, 'media', 'Игра престолов (2011)');
  expect(existsSync(show) && readdirSync(path.join(show, 'Season 01')).length).toBeTruthy();
  await loginWithCode(page);

  await page.goto('/storage');
  await expect(page.getByRole('heading', { name: 'Хранилище' })).toBeVisible();
  await page.getByRole('button', { name: 'Удалить «Игра престолов»' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Только файлы, подписка остаётся').click();
  await dialog.getByRole('button', { name: 'Удалить файлы' }).click();
  // строка сериала пропадает из списка вместе с диалогом
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Удалить «Игра престолов»' })).toBeHidden();

  expect(existsSync(show)).toBe(false);
  await page.reload();
  await expect(page.getByText('Игра престолов · все файлы')).toBeVisible();
  await page.goto('/series/1399');
  await expect(page.getByText('активна')).toBeVisible();
});
