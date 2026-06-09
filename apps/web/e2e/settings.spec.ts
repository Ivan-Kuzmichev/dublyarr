import { expect, test } from "@playwright/test";

test("сохранение интеграций переживает перезагрузку", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("TMDb API ключ").fill("test-tmdb-key");
  await page.getByLabel("Jackett URL").fill("http://192.168.1.50:9117");
  await page.getByLabel("Jackett API ключ").fill("test-jackett-key");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("TMDb API ключ")).toHaveValue("test-tmdb-key");
  await expect(page.getByLabel("Jackett URL")).toHaveValue("http://192.168.1.50:9117");
});
