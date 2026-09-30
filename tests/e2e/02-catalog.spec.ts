import { test, expect } from '@playwright/test';
import { loginWithCode } from './helpers';

test('ключ TMDB в настройках → тренды → поиск → карточка → смена типа', async ({ page }) => {
  await loginWithCode(page);

  await page.goto('/discover');
  await expect(page.getByText('Добавьте ключ TMDB')).toBeVisible();
  await page.goto('/settings/sources');
  await page.getByLabel('Ключ API').fill('bad');
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(page.getByText('Неверный ключ TMDB')).toBeVisible();
  await page.getByLabel('Ключ API').fill('ok');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Сохранено · TMDB отвечает')).toBeVisible();

  await page.goto('/discover');
  await expect(page.getByRole('heading', { name: 'Популярное за неделю' })).toBeVisible();
  await page.getByPlaceholder('Название сериала').fill('атака');
  await expect(page.getByText('Найдено: 1')).toBeVisible();
  await expect(page).toHaveURL(/q=/);
  await page.getByRole('link', { name: /Атака титанов/ }).click();
  await expect(page.getByRole('heading', { name: 'Атака титанов', level: 1 })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Аниме' })).toBeChecked();

  await page.goto('/series/1399');
  await expect(page.getByText('Зима близко')).toBeVisible();
  await page.getByText('Аниме', { exact: true }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Аниме' })).toBeChecked({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  const img = await page.request.get('/api/image/w342/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg');
  expect(img.status()).toBe(200);
  expect((await page.request.get('/api/image/w342/..%2Fsecret.key')).status()).toBeGreaterThanOrEqual(400);
});
