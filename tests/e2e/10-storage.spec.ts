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

  // одна серия: «Сезоны или серии» → раскрыть сезон → отметить первую серию
  const season = path.join(show, 'Season 01');
  const before = readdirSync(season).length;
  expect(before).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Удалить «Игра престолов»' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Сезоны или серии').click();
  await expect(dialog.getByRole('button', { name: 'Удалить выбранное' })).toBeDisabled();
  await dialog.getByRole('button', { name: /Сезон 1/ }).click();
  await dialog.getByRole('checkbox').nth(1).check();
  await dialog.getByRole('button', { name: 'Удалить выбранное' }).click();
  await expect(dialog.getByText(/Удалено файлов: 1/)).toBeVisible();
  expect(readdirSync(season).length).toBe(before - 1);
  await dialog.getByRole('button', { name: 'Закрыть' }).click();
  await page.reload();
  await expect(page.getByText(/Игра престолов · S01E\d\d/)).toBeVisible();

  await page.getByRole('button', { name: 'Удалить «Игра престолов»' }).click();
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
