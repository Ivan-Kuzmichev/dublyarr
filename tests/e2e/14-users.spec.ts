import { test, expect } from '@playwright/test';
import { loginWithCode } from './helpers';

test('пользователи: админ создаёт учётку с правом «Подписки» → у неё только «Уведомления» и «Безопасность», подписка есть, ручного поиска нет → выключена — вход закрыт', async ({ page, browser }) => {
  await loginWithCode(page);
  await page.goto('/settings/users');
  await page.getByRole('button', { name: '+ Добавить пользователя' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Логин').fill('anya');
  await dialog.getByLabel('Временный пароль').fill('временный-пароль');
  await dialog.getByLabel('Ручной поиск и «Скачать»').uncheck();
  await dialog.getByLabel('Ответы на вопросы').uncheck();
  await dialog.getByRole('button', { name: 'Создать' }).click();
  await expect(page.getByText('anya', { exact: true })).toBeVisible();

  // Аня входит в своём браузере
  const ctx = await browser.newContext();
  const anya = await ctx.newPage();
  await anya.goto('/login');
  await anya.getByLabel('Логин').fill('anya');
  await anya.getByLabel('Пароль', { exact: true }).fill('временный-пароль');
  await anya.getByRole('button', { name: 'Войти' }).click();
  await expect(anya.getByRole('heading', { name: 'Сегодня' })).toBeVisible();

  await anya.goto('/settings/security');
  const nav = anya.getByRole('navigation', { name: 'Разделы настроек' });
  await expect(nav.getByRole('link')).toHaveText(['Уведомления', 'Безопасность']);
  await nav.getByRole('link', { name: 'Уведомления' }).click();
  await expect(anya.getByRole('heading', { name: 'Мой чат' })).toBeVisible(); // ссылка ведёт на настоящую страницу, а не в 404
  await expect(anya.getByRole('heading', { name: 'Telegram-бот' })).toHaveCount(0);
  await expect(anya.getByText('API включён')).toHaveCount(0);
  expect((await anya.goto('/settings/sources'))!.status()).toBe(404);

  // подписка — можно; ручной поиск — нет
  await anya.goto('/series/1429');
  await expect(anya.getByRole('link', { name: 'Ручной поиск', exact: true })).toHaveCount(0);
  await anya.getByRole('button', { name: 'Подписаться' }).click();
  await anya.getByRole('dialog').getByRole('button', { name: 'Подписаться' }).click();
  await expect(anya.getByText(/активна · добавил anya/)).toBeVisible();
  expect((await anya.goto('/search/1429?s=1'))!.status()).toBe(404);

  // админ выключает Аню — её сеанс закрыт, вход запрещён
  await page.goto('/settings/users');
  await page.locator('article, section, div').filter({ hasText: /^anya/ }).getByRole('button', { name: 'Изменить' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Выключить' }).click();
  await expect(page.getByText('выключен').first()).toBeVisible();
  await anya.goto('/');
  await expect(anya).toHaveURL(/\/login/);
  await anya.getByLabel('Логин').fill('anya');
  await anya.getByLabel('Пароль', { exact: true }).fill('временный-пароль');
  await anya.getByRole('button', { name: 'Войти' }).click();
  await expect(anya.getByText('Учётка выключена')).toBeVisible();
  await ctx.close();
});
