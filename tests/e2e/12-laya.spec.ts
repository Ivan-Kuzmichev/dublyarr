import { test, expect } from '@playwright/test';
import { loginWithCode } from './helpers';

test('Laya: статус и проверка → ответ «Не тот сериал» — пример в «Примерах», его можно убрать', async ({ page }) => {
  test.setTimeout(180_000);
  await loginWithCode(page);

  await page.goto('/settings/ai');
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/^Модель загружена/)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(page.getByText(/^Laya отвечает · /)).toBeVisible();

  // порог и задачи сохраняются
  await page.getByRole('group', { name: 'Порог уверенности' }).getByRole('button', { name: 'Больше' }).click();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Сохранено')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Порог уверенности' })).toContainText('86%');

  // «Дообученная Laya»: в этой версии голов нет — работает базовая, переключателя нет
  await expect(page.getByText(/^В этой версии Dublyarr дообученной модели нет/)).toBeVisible();

  // ответ в ручном поиске — пример для дообучения
  await page.goto('/search/1399?s=1');
  const answer = page.getByRole('button', { name: /^(Это он|Не тот сериал)$/ });
  const row = page.locator('div.grid.border-t').filter({ has: answer }).first();
  const release = (await row.locator('span.font-mono').first().textContent())!.trim();
  await row.getByRole('button', { name: /^(Это он|Не тот сериал)$/ }).first().click();
  await page.goto('/settings/ai/examples');
  const examples = page.getByText(release, { exact: true }); // «тот ли сериал» и финальные проверки этой раздачи
  await expect(examples.first()).toBeVisible();
  const before = await examples.count();
  await page.getByRole('button', { name: 'Убрать пример' }).first().click();
  await expect(examples).toHaveCount(before - 1);
});
