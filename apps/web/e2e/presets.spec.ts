import { expect, test } from "@playwright/test";

test("редактор пресетов: сид, создание и удаление", async ({ page }) => {
  await page.goto("/settings?tab=quality");
  await expect(page.getByTestId("preset-card")).toHaveCount(2);
  await expect(page.locator("input[value='FullHD']")).toBeVisible();

  await page.getByTestId("preset-new").click();
  const draft = page.getByTestId("preset-card").last();
  await draft.locator("label", { hasText: "Название" }).locator("input").fill("Тест 720p");
  await draft.locator("label", { hasText: /^720p$/ }).locator("input").check();
  await draft.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.locator("input[value='Тест 720p']")).toBeVisible();

  page.on("dialog", (d) => d.accept());
  const created = page.getByTestId("preset-card").filter({
    has: page.locator("input[value='Тест 720p']"),
  });
  await created.getByRole("button", { name: "Удалить" }).click();
  await expect(page.locator("input[value='Тест 720p']")).toHaveCount(0);
});
