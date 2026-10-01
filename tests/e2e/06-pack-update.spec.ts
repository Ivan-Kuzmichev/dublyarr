import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loginWithCode } from './helpers';

test('топик пака обновился → новая серия докачивается в ту же раздачу', async ({ page, request }) => {
  test.setTimeout(300_000);
  const season = path.join(process.env.E2E_DIR!, 'media', 'Игра престолов (2011)', 'Season 01');
  await loginWithCode(page);

  // вышла серия 3, а раздача LostFilm обновилась
  await request.post('http://127.0.0.1:3199/__air?ep=3&date=2011-05-01');
  await request.post('http://127.0.0.1:3198/__update');
  await page.goto('/series/1399?season=1');
  await page.getByRole('button', { name: 'Обновить из TMDB' }).click();
  await expect(page.getByText('1 мая 2011')).toBeVisible();

  // отдельная раздача серии 3 предпочтительнее пака — убираем её, чтобы серия пошла через обновлённый пак
  await page.goto('/search/1399?s=1&e=3');
  const single = page.locator('div.grid.border-t', { hasText: 'Lord Snow' });
  await single.getByRole('button', { name: 'Не тот сериал' }).click();
  await expect(single).toContainText('В чёрном списке');

  await page.goto('/activity');
  await page.getByRole('button', { name: 'Искать сейчас' }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByText('Обновлена: +серия 3')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });

  await expect(async () => {
    await page.reload();
    await expect(page.getByText('В медиатеке')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 150_000 });
  expect(existsSync(path.join(season, 'Игра престолов S01E03 [LostFilm 1080p].mkv'))).toBe(true);
  await page.goto('/series/1399?season=1');
  await expect(page.getByText('Скачана', { exact: true })).toHaveCount(3);
});
