import { expect, test } from "@playwright/test";

const tmdbKey = process.env.TMDB_API_KEY;

test.skip(!tmdbKey, "нужен TMDB_API_KEY в окружении");

test("страница тайтла: hero Рика и Морти", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("TMDb API ключ").fill(tmdbKey!);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();

  await page.goto("/title/tv/60625"); // Rick and Morty
  await expect(page.getByRole("heading", { name: /Рик и Морти/ })).toBeVisible();
  await expect(page.getByText(/Rick and Morty/)).toBeVisible();
  await expect(page.getByText(/сезон/i).first()).toBeVisible();
});
