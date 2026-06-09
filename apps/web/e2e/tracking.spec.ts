import { expect, test } from "@playwright/test";

const TMDB_KEY = process.env.TMDB_API_KEY;

test.describe("отслеживание", () => {
  test.skip(!TMDB_KEY, "нужен TMDB_API_KEY в .env");

  test("добавить → бейджи → убрать", async ({ page, request }) => {
    await request.put("/api/settings", { data: { tmdb_api_key: TMDB_KEY } });

    await page.goto("/title/tv/60625");
    await expect(page.getByTestId("tracking-block")).toBeVisible();
    await page.getByTestId("tracking-add").click();
    await expect(page.getByTestId("tracking-remove")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("✓ отслеживается")).toBeVisible();
    await expect(page.getByTestId("episode-list")).toBeVisible();

    await page.goto("/");
    await expect(page.getByText("Сериалы")).toBeVisible();
    await expect(page.getByText("Рик и Морти")).toBeVisible();

    await page.goto("/search?q=rick+and+morty");
    await expect(page.getByText("✓ отслеживается").first()).toBeVisible();

    await page.goto("/title/tv/60625");
    page.on("dialog", (d) => d.accept());
    await page.getByTestId("tracking-remove").click();
    await expect(page.getByTestId("tracking-add")).toBeVisible();
  });
});
