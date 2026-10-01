import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loginWithCode } from './helpers';

test('фильм: поиск → подписка → многоголосый ждёт дубляж → дубляж → файл в папке фильмов', async ({ page, request }) => {
  test.setTimeout(300_000);
  const dir = process.env.E2E_DIR!;
  const movies = path.join(dir, 'movies');
  mkdirSync(movies, { recursive: true });
  await loginWithCode(page);

  await page.goto('/settings/download');
  const paths = page.locator('section', { has: page.getByRole('heading', { name: 'Папки' }) });
  await paths.getByLabel('Папка фильмов').fill(movies);
  await paths.getByRole('button', { name: 'Сохранить' }).click();
  await expect(paths.getByText(/^Сохранено/)).toBeVisible();

  await page.goto('/discover?q=Матрица');
  await page.getByRole('link', { name: /Матрица.*Фильм/ }).click();
  await expect(page.getByRole('heading', { name: 'Матрица', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Подписаться' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Ждать дубляж после цифрового релиза')).toBeVisible();
  await dialog.getByRole('button', { name: 'Подписаться' }).click();
  await expect(dialog).toBeHidden();

  // на трекере только многоголосый: цифровой релиз сегодня, дубляж ждём 14 дней
  await page.goto('/activity');
  await page.getByRole('button', { name: 'Искать сейчас' }).click();
  await expect(async () => {
    await page.goto('/movie/603');
    await expect(page.getByText(/^ждём до /)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });
  await page.goto('/library');
  await expect(page.getByText(/Ждём дубляж до/)).toBeVisible();

  // вышел дубляж — качаем его
  await request.post('http://127.0.0.1:3198/__movie?stage=dub');
  await page.goto('/activity');
  await page.getByRole('button', { name: 'Искать сейчас' }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('link', { name: /Матрица · фильм/ })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });

  await expect(async () => {
    await page.goto('/movie/603');
    await expect(page.getByText('Дубляж · 1080p', { exact: false })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 150_000 });
  const folder = path.join(movies, 'Матрица (1999)');
  expect(existsSync(folder)).toBe(true);
  expect(readdirSync(folder)).toEqual(['Матрица (1999) [Дубляж 1080p].mkv']);
});
