import { test, expect } from '@playwright/test';
import { loginWithCode } from './helpers';

test('Laya: статус и проверка, выключатель → ответ «Не тот сериал» — пример в «Примерах», его можно убрать', async ({ page }) => {
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

  // главный выключатель: выключена — laya-serve остановлен, разделы ниже не действуют; включена — запускается снова
  const power = page.getByRole('switch', { name: 'Laya включена' });
  await power.click();
  await expect(page.getByText('Laya выключена и выгружена из памяти')).toBeVisible();
  await page.reload();
  await expect(power).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText(/^Разделы ниже не действуют/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Проверить' })).toHaveCount(0);
  await power.click();
  await expect(page.getByText(/^Laya запускается/)).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/^Модель загружена/)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(page.getByText(/^Laya отвечает · /)).toBeVisible();

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
