import { test, expect } from '@playwright/test';
import { loginWithCode } from './helpers';

test('API: выключен → включить, токен, статус; «Диагностика» видит запрос', async ({ page, request }) => {
  await loginWithCode(page);
  expect((await request.get('/api/v1/status')).status()).toBe(403);

  await page.goto('/settings/security');
  await page.getByLabel('API включён').check();
  await page.getByRole('button', { name: 'Сохранить доступ' }).click();
  await expect(page.getByText('API включён', { exact: true }).last()).toBeVisible();
  await page.getByLabel('Имя токена').fill('claude');
  await page.getByRole('button', { name: 'Создать токен' }).click();
  const token = (await page.getByTestId('api-token').textContent())!.trim();
  expect(token).toMatch(/^dy_/);

  expect((await request.get('/api/v1/status')).status()).toBe(401);
  const auth = { authorization: `Bearer ${token}` };
  const ok = await request.get('/api/v1/status', { headers: auth });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ services: expect.any(Array), jobs: expect.any(Array) });
  // через прокси с внешним адресом — нельзя
  expect((await request.get('/api/v1/status', { headers: { ...auth, 'x-forwarded-for': '203.0.113.7' } })).status()).toBe(403);

  // загрузки из предыдущих сценариев видны через API
  const dl = await request.get('/api/v1/downloads', { headers: auth });
  expect(dl.status()).toBe(200);
  expect(Array.isArray(await dl.json())).toBe(true);

  // журнал: запрос API записан (супервизор пишет в /data/logs)
  await expect
    .poll(async () => JSON.stringify(await (await request.get('/api/v1/logs?area=api&lines=50', { headers: auth })).json()), { timeout: 10_000 })
    .toContain('/status');

  await page.goto('/settings/diagnostics?area=api');
  await expect(page.getByRole('heading', { name: 'Диагностика' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Сверка с qBittorrent' })).toBeVisible();
  await expect(page.locator('main')).toContainText('/status'); // запись API в журнале (подробности строки)
});
