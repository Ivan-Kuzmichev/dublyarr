import { test, expect } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loginWithCode } from './helpers';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('sv-SE');

test('вышло 2160p → замена → подтверждение удаления старых копий', async ({ page, request }) => {
  test.setTimeout(300_000);
  const media = path.join(process.env.E2E_DIR!, 'media');
  const season = path.join(media, 'Игра престолов (2011)', 'Season 01');
  await loginWithCode(page);

  // серии вышли недавно (замену ищем 30 дней после эфира), появился пак 2160p
  for (const ep of [1, 2, 3]) await request.post(`http://127.0.0.1:3199/__air?ep=${ep}&date=${daysAgo(2)}`);
  await request.post('http://127.0.0.1:3198/__add2160');
  await page.goto('/series/1399?season=1');
  await page.getByRole('button', { name: 'Обновить из TMDB' }).click();
  await expect(page.getByText('Скачана', { exact: true })).toHaveCount(3);

  await page.goto('/activity');
  await page.getByRole('button', { name: 'Искать сейчас' }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/Улучшение: 1080p → 2160p/)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });

  // после импорта старые копии ждут подтверждения правила
  await expect(async () => {
    await page.goto('/');
    await expect(page.getByText('Старые копии после улучшения')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 150_000 });
  await page.getByText('Старые копии после улучшения').click();
  await expect(page.getByRole('heading', { name: 'Старые копии' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await page.getByRole('button', { name: 'Удалить отмеченные' }).click();
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible();

  expect(readdirSync(season).sort()).toEqual([1, 2, 3].map((n) => `Игра престолов S01E0${n} [LostFilm 2160p].mkv`));
  const old = path.join(media, '.dublyarr-old', 'Игра престолов (2011)', 'Season 01');
  expect(existsSync(old) ? readdirSync(old) : []).toEqual([]);
});
