import { expect, test } from "@playwright/test";

const tmdbKey = process.env.TMDB_API_KEY;

test.skip(!tmdbKey, "нужен TMDB_API_KEY в окружении");

test("поиск находит Рика и Морти", async ({ page, request }) => {
  await request.put("/api/settings", { data: { tmdb_api_key: tmdbKey } });

  await page.goto("/search");
  await page.getByPlaceholder("Название фильма или сериала").fill("рик и морти");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("link", { name: /Рик и Морти/ }).first(),
  ).toBeVisible();
});
