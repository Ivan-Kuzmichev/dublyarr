import { expect, test } from "@playwright/test";

test("вкладка «Папки и имена»: сохранение переживает перезагрузку", async ({ page }) => {
  await page.goto("/settings?tab=folders");
  await expect(page.getByTestId("folders-form")).toBeVisible();

  await page.getByLabel("Папка фильмов").fill("/tmp/dublyarr-movies");
  await page.getByLabel("Папка сериалов").fill("/tmp/dublyarr-tv");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Папка фильмов")).toHaveValue("/tmp/dublyarr-movies");
  await expect(page.getByLabel("Папка сериалов")).toHaveValue("/tmp/dublyarr-tv");
});

test("в настройках три вкладки и поля qBittorrent", async ({ page }) => {
  await page.goto("/settings?tab=integrations");
  const tabs = page.getByTestId("settings-tabs");
  await expect(tabs.getByText("Качество")).toBeVisible();
  await expect(tabs.getByText("Интеграции")).toBeVisible();
  await expect(tabs.getByText("Папки и имена")).toBeVisible();
  await expect(page.getByLabel("qBittorrent URL")).toBeVisible();
});
