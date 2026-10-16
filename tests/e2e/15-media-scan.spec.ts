import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loginWithCode } from './helpers';

test('медиатека: чужая папка → «Сканировать» → окно → «Добавить» → файл по шаблону Dublyarr, старая папка убрана', async ({ page }) => {
  test.setTimeout(120_000);
  const media = path.join(process.env.E2E_DIR!, 'media');
  mkdirSync(path.join(media, 'Атака титанов/Season 01'), { recursive: true });
  writeFileSync(path.join(media, 'Атака титанов/Season 01/Атака титанов - S01E02 - WEB-DL 1080p.mkv'), 'v');
  writeFileSync(path.join(media, 'Атака титанов/.DS_Store'), 'x');
  await loginWithCode(page);
  await page.goto('/storage');
  await page.getByRole('button', { name: 'Сканировать' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Найдено в медиатеке' })).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByText(/^Атака титанов · 2013/)).toBeVisible();
  await expect(dialog.getByText('Season 01: 2')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Добавить Атака титанов' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByText(/^Добавлено 1/)).toBeVisible({ timeout: 60_000 });
  expect(existsSync(path.join(media, 'Атака титанов'))).toBe(false);
  expect(readdirSync(path.join(media, 'Атака титанов (2013)', 'Season 01'))).toContainEqual(expect.stringMatching(/^Атака титанов S01E02 \[.*1080p\]\.mkv$/));
});
