import { test, expect } from '@playwright/test';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { loginWithCode } from './helpers';

const videos = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? videos(path.join(dir, e.name)) : e.name.endsWith('.mkv') ? [path.join(dir, e.name)] : []));

test('уборка «сразу после импорта» → подтверждение → торренты и их файлы убраны, медиатека на месте', async ({ page }) => {
  test.setTimeout(240_000);
  const dir = process.env.E2E_DIR!;
  const downloads = path.join(dir, 'qbit', 'dublyarr');
  const season = path.join(dir, 'media', 'Игра престолов (2011)', 'Season 01');
  expect(videos(downloads).length).toBeGreaterThan(0);
  await loginWithCode(page);

  await page.goto('/settings/download');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Уборка в qBittorrent' }) });
  await card.getByText('сразу после импорта').click();
  await card.getByRole('button', { name: 'Сохранить' }).click();
  await expect(card.getByText('Сохранено')).toBeVisible();

  // воркер прогоняет уборку и оставляет сводку «ждёт подтверждения»
  await expect(async () => {
    await page.goto('/');
    await expect(page.getByText('Уборка загрузок')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });
  await page.getByText('Уборка загрузок').click();
  await expect(page.getByRole('heading', { name: 'Уборка загрузок' })).toBeVisible();
  expect(await page.getByRole('checkbox').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Удалить отмеченные' }).click();
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible();

  expect(videos(downloads)).toEqual([]);
  const media = readdirSync(season).sort();
  expect(media).toEqual([1, 2, 3].map((n) => `Игра престолов S01E0${n} [LostFilm 2160p].mkv`));
  for (const f of media) expect(statSync(path.join(season, f)).size).toBeGreaterThan(0);
});
