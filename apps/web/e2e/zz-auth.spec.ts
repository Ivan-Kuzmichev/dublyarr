import { expect, request as pwRequest, test } from "@playwright/test";

const PASSWORD = "e2e-секрет";
const BASE = "http://localhost:3100";

// Снятие пароля даже при упавшем тесте: логинимся свежим контекстом и сбрасываем.
async function cleanup() {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await ctx.post("/api/auth/login", { data: { password: PASSWORD } }).catch(() => {});
  await ctx
    .post("/api/auth/password", { data: { current: PASSWORD, next: "" } })
    .catch(() => {});
  await ctx.put("/api/settings", { data: { auth_lan_bypass: "1" } }).catch(() => {});
  await ctx.dispose();
}

test.afterAll(cleanup);

test("пароль включает защиту: redirect, 401 API, вход, выход", async ({ page, request }) => {
  // 1. Пока auth выключен — отключаем LAN-обход, затем ставим пароль.
  //    (порядок важен: PUT настроек должен пройти ДО включения защиты)
  const bypassOff = await request.put("/api/settings", { data: { auth_lan_bypass: "0" } });
  expect(bypassOff.ok()).toBe(true);
  const set = await request.post("/api/auth/password", { data: { current: "", next: PASSWORD } });
  expect(set.ok()).toBe(true);

  // 2. Свежий неавторизованный контекст: API → 401
  const anon = await pwRequest.newContext({ baseURL: BASE });
  const apiRes = await anon.get("/api/presets");
  expect(apiRes.status()).toBe(401);
  await anon.dispose();

  // 3. Страница без сессии → redirect на /login
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId("login-form")).toBeVisible();

  // 4. Неверный пароль → ошибка, остаёмся на /login
  await page.getByLabel("Пароль").fill("не тот");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText("Неверный пароль")).toBeVisible();

  // 5. Верный пароль → попадаем на главную
  await page.getByLabel("Пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("top-nav")).toBeVisible();

  // 6. Снимаем пароль через вкладку Безопасность (уже залогинены)
  await page.goto("/settings?tab=security");
  await expect(page.getByTestId("security-form")).toBeVisible();
  await page.getByLabel("Текущий пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Сохранить пароль" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();

  // 7. Защита снята: свежий контекст видит API без логина
  const anon2 = await pwRequest.newContext({ baseURL: BASE });
  const open = await anon2.get("/api/presets");
  expect(open.ok()).toBe(true);
  await anon2.dispose();
});
