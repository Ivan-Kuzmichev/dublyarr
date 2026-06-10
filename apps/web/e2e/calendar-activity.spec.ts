import { expect, test } from "@playwright/test";

test("страница «Активность» открывается с заголовком и секциями", async ({ page }) => {
  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "Активность", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Загрузки" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "История" })).toBeVisible();
});

test("страница «Календарь» открывается", async ({ page }) => {
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Календарь", level: 1 })).toBeVisible();
});

test("навигация ведёт на Календарь", async ({ page }) => {
  await page.goto("/");
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.getByTestId("top-nav").getByRole("link", { name: "Календарь" }).click();
  await expect(page).toHaveURL(/\/calendar$/);
});
