import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loginWithCode } from './helpers';

test('qBittorrent и папки → подписка → «Искать сейчас» → загрузка → файл в медиатеке', async ({ page }) => {
  test.setTimeout(300_000);
  const dir = process.env.E2E_DIR!;
  mkdirSync(path.join(dir, 'qbit'), { recursive: true });
  mkdirSync(path.join(dir, 'media'), { recursive: true });
  await loginWithCode(page);

  await page.goto('/settings/download');
  const qbit = page.locator('section', { has: page.getByRole('heading', { name: 'qBittorrent' }) });
  await qbit.getByLabel('Адрес').fill('http://127.0.0.1:3197');
  await qbit.getByLabel('Пароль', { exact: true }).fill('bad');
  await qbit.getByRole('button', { name: 'Проверить' }).click();
  await expect(qbit.getByRole('alert')).toBeVisible();
  await qbit.getByLabel('Пароль', { exact: true }).fill('pw');
  await qbit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(qbit.getByText('Сохранено · qBittorrent v5.1.2')).toBeVisible();

  const paths = page.locator('section', { has: page.getByRole('heading', { name: 'Папки' }) });
  await paths.getByLabel('Папка загрузок в qBittorrent').fill('/downloads');
  await paths.getByLabel('Та же папка в Dublyarr').fill(path.join(dir, 'qbit'));
  await paths.getByLabel('Медиатека').fill(path.join(dir, 'media'));
  await paths.getByRole('button', { name: 'Проверить' }).click();
  await expect(paths.getByText('Жёсткие ссылки работают')).toBeVisible();
  await paths.getByRole('button', { name: 'Сохранить' }).click();
  await expect(paths.getByText(/^Сохранено/)).toBeVisible();

  await page.goto('/series/1399');
  await page.getByRole('button', { name: 'Подписаться' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Все сезоны').click();
  await dialog.getByRole('button', { name: 'Подписаться' }).click();
  await expect(dialog).toBeHidden();

  await page.goto('/activity');
  await page.getByRole('button', { name: 'Искать сейчас' }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('link', { name: /Игра престолов · S01/ })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByText('Game of Thrones / S1E1-10 of 10')).toBeVisible();

  // синхронизация раз в минуту: «докачка» в заглушке → импорт
  await expect(async () => {
    await page.reload();
    await expect(page.getByText('В медиатеке')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 150_000 });
  const season = path.join(dir, 'media', 'Игра престолов (2011)', 'Season 01');
  expect(existsSync(season)).toBe(true);
  expect(readdirSync(season).sort()).toEqual(['Игра престолов S01E01 [LostFilm 1080p].mkv', 'Игра престолов S01E02 [LostFilm 1080p].mkv']);

  await page.goto('/series/1399?season=1');
  await expect(page.getByText('Скачана', { exact: true }).first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Новые серии' })).toBeVisible();
  await expect(page.getByText('LostFilm · скачано').first()).toBeVisible();
});
