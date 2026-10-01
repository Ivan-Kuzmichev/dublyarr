import { test, expect } from '@playwright/test';
import { loginWithCode } from './helpers';

test('источник → ручной поиск → вердикты → назначить студию → не тот сериал', async ({ page }) => {
  await loginWithCode(page);

  await page.goto('/settings/sources');
  await page.getByRole('button', { name: '+ Добавить источник' }).click();
  await page.getByLabel('Адрес Jackett').fill('http://127.0.0.1:3198');
  await page.getByLabel('API-ключ').fill('bad');
  await page.getByRole('button', { name: 'Проверить и сохранить' }).click();
  await expect(page.getByText('Неверный API-ключ')).toBeVisible();
  await page.getByLabel('API-ключ').fill('ok');
  await page.getByRole('button', { name: 'Проверить и сохранить' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('3 трекера')).toBeVisible();
  await expect(page.getByText('RuTracker.org')).toBeVisible();

  await page.goto('/series/1399');
  await page.getByRole('link', { name: 'Ручной поиск', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ручной поиск' })).toBeVisible();

  await page.goto('/search/1399?s=1&e=3');
  const rows = page.locator('div.grid.border-t');
  await expect(rows.first()).toContainText('Lord Snow');
  await expect(rows.first()).toContainText('Лучший · 1-я по приоритету');
  await expect(page.locator('div.grid.border-t', { hasText: 'Kinozal' })).toContainText('Нет сидов');

  // нераспознанная студия
  const zaycev = page.locator('div.grid.border-t', { hasText: 'Zaycev Studio' });
  await expect(zaycev).toContainText('Zaycev Studio?');
  await zaycev.getByRole('button', { name: 'Назначить студию' }).click();
  await page.getByRole('dialog').getByText('Новая студия «Zaycev Studio»').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Назначить' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(zaycev.getByRole('button', { name: 'Назначить студию' })).toBeHidden();
  await expect(zaycev).not.toContainText('Zaycev Studio?');

  // не тот сериал
  const lf = page.locator('div.grid.border-t', { hasText: 'BDRip 720p' });
  await lf.getByRole('button', { name: 'Не тот сериал' }).click();
  await expect(lf).toContainText('В чёрном списке');
  await lf.getByRole('button', { name: 'Это он' }).click();
  await expect(lf).not.toContainText('В чёрном списке');
});
