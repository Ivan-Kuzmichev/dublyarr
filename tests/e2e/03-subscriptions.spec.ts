import { test, expect } from '@playwright/test';
import { loginWithCode } from './helpers';

test('подписка → карточка → библиотека → правка → отписка; словарь студий', async ({ page }) => {
  await loginWithCode(page);

  await page.goto('/library');
  await expect(page.getByText('Библиотека пуста')).toBeVisible();

  // сценарий 02 переключил сериал в «Аниме» — возвращаем тип, чтобы подставился профиль сериалов
  await page.goto('/series/1399');
  await page.getByText('Сериал', { exact: true }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Сериал' })).toBeChecked({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  // подписка с изменённым порядком и качеством
  await page.getByRole('button', { name: 'Подписаться' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^1\s*LostFilm/ }).click(); // убрать LostFilm из порядка
  await dialog.getByRole('radio', { name: '1080p' }).click();
  await dialog.getByRole('button', { name: 'Подписаться' }).click();
  await expect(dialog).toBeHidden();

  const panel = page.getByRole('region', { name: 'Подписка' });
  await expect(panel.getByText('активна')).toBeVisible();
  await expect(panel.getByText('HDrezka Studio')).toBeVisible();
  await expect(panel.getByText('если нет — через 5 дн после эфира')).toBeVisible();
  await expect(panel.getByText('1080p, иначе ниже · HDR')).toBeVisible();

  await page.goto('/library');
  await expect(page.getByRole('link', { name: /Игра престолов/ })).toBeVisible();
  await expect(page.getByText('1080p · HDrezka Studio → Любая')).toBeVisible();

  // правка: качество 2160p
  await page.goto('/series/1399');
  await page.getByRole('button', { name: 'Подписка', exact: true }).click();
  await dialog.getByRole('radio', { name: '2160p' }).click();
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText('2160p, иначе ниже · HDR')).toBeVisible();

  // словарь: конфликт и новая студия
  await page.goto('/settings/studios');
  await page.getByRole('button', { name: '+ Студия' }).click();
  await page.getByLabel('Название').fill('Paravozik');
  await page.getByLabel('Варианты написания').fill('HDrezka');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('«HDrezka» уже есть у студии HDrezka Studio')).toBeVisible();
  await page.getByLabel('Варианты написания').fill('Паровозик');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Паровозик')).toBeVisible();

  // новая студия есть в окне; отписка
  await page.goto('/series/1399');
  await page.getByRole('button', { name: 'Подписка', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Paravozik' })).toBeVisible();
  // «Сбросить выбранное» — порядок озвучек пуст
  await dialog.getByRole('button', { name: 'Сбросить выбранное' }).click();
  await expect(dialog.getByText('нажми, чтобы задать порядок')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^1\s/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Отписаться' }).click();
  await dialog.getByRole('button', { name: 'Точно отписаться' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Подписаться' })).toBeVisible();

  await page.goto('/library');
  await expect(page.getByText('Библиотека пуста')).toBeVisible();
});
