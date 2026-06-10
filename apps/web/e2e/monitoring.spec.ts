import { expect, test } from "@playwright/test";

test("вкладка «Мониторинг»: сохранение переживает перезагрузку", async ({ page }) => {
  await page.goto("/settings?tab=monitoring");
  await expect(page.getByTestId("monitoring-form")).toBeVisible();

  await page.getByLabel("Интервал проверки (мин)").fill("30");
  await page.getByLabel("Минимум сидов").fill("5");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Интервал проверки (мин)")).toHaveValue("30");
  await expect(page.getByLabel("Минимум сидов")).toHaveValue("5");
});

test("в настройках видна вкладка «Мониторинг»", async ({ page }) => {
  await page.goto("/settings?tab=integrations");
  await expect(page.getByTestId("settings-tabs").getByText("Мониторинг")).toBeVisible();
});
