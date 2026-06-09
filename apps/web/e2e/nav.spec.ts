import { expect, test } from "@playwright/test";

test("десктоп: верхняя навигация, таб-бар скрыт", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("top-nav")).toBeVisible();
  await expect(page.getByTestId("tab-bar")).toBeHidden();
  await page.getByRole("link", { name: "Календарь" }).click();
  await expect(page.getByRole("heading", { name: "Календарь" })).toBeVisible();
});

test("мобильный: таб-бар и шапка, верхняя навигация скрыта", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("tab-bar")).toBeVisible();
  await expect(page.getByTestId("top-nav")).toBeHidden();
  await expect(page.getByTestId("mobile-head")).toBeVisible();
});
