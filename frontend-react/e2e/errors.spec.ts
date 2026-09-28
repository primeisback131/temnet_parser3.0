import { expect, test, type Page, type Route } from "@playwright/test";

// What the user sees when something fails. Before 2026-09-28 a dead backend
// looked like a logout, a lost network read "Failed to fetch", a render crash
// or a chunk gone after a redeploy left an empty page, and a failed Excel
// export did nothing at all.

const admin = {
  username: "admin",
  fullName: "Администратор",
  role: "admin",
  mustChangePassword: false,
  unrestricted: true,
  metricsGroups: [],
  chatGroups: [],
  helpAccounts: [],
};

const company = {
  groupName: "Альфа",
  activeUsers: 1,
  totalUsers: 2,
  closedRequests: 3,
  rejectedRequests: 0,
  openRequests: 1,
  totalMessages: 10,
};

type Handler = (route: Route, path: string) => Promise<void> | undefined;

/** Signed-in admin, everything empty, except the paths `override` answers. */
async function mockApi(page: Page, override?: Handler) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return override?.(route, path) ?? route.fulfill({ json: path === "/api/auth/me" ? admin : [] });
  });
}

/** The empty-bodied 500 Vite's proxy sends while the backend is down. */
const proxyDown = (route: Route) => route.fulfill({ status: 500, body: "" });

test("сервер недоступен при запуске - экран с повтором, а не вход", async ({ page }) => {
  let up = false;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!up) return proxyDown(route);
    return route.fulfill({ json: path === "/api/auth/me" ? admin : [] });
  });
  await page.goto("/companies");
  await expect(page.getByText("Сервер недоступен", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /войти/i })).toHaveCount(0);
  up = true;
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(page.getByRole("menuitem", { name: "Компании" })).toBeVisible();
});

test("обрыв сети - понятный текст вместо Failed to fetch, один повтор", async ({ page }) => {
  let attempts = 0;
  await mockApi(page, (route, path) => (path === "/api/companies" ? (attempts++, route.abort("failed")) : undefined));
  await page.goto("/companies");
  await expect(page.getByText("Нет связи с сервером")).toBeVisible();
  await expect(page.getByText("Failed to fetch")).toHaveCount(0);
  // A dropped connection is worth one retry; before, status 0 counted as a 4xx.
  expect(attempts).toBe(2);
});

test("пустой 500 от прокси - сервер перезапускается; Повторить догружает данные", async ({ page }) => {
  let down = true;
  await mockApi(page, (route, path) =>
    path === "/api/companies" ? (down ? proxyDown(route) : route.fulfill({ json: [company] })) : undefined,
  );
  await page.goto("/companies");
  await expect(page.getByText("Сервер недоступен или перезапускается", { exact: false })).toBeVisible();
  down = false;
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(page.getByRole("cell", { name: "Альфа" })).toBeVisible();
});

test("403 - предупреждение с текстом бэкенда, не авария", async ({ page }) => {
  await mockApi(page, (route, path) =>
    path === "/api/companies" ? route.fulfill({ status: 403, json: { message: "Нет доступа к группе Бета" } }) : undefined,
  );
  await page.goto("/companies");
  const alert = page.locator(".ant-alert", { hasText: "Нет доступа к группе Бета" });
  await expect(alert).toBeVisible();
  await expect(alert).toHaveClass(/ant-alert-warning/);
  // Retrying a missing right fails again: no button for it.
  await expect(alert.getByRole("button", { name: "Повторить" })).toHaveCount(0);
});

test("падение отрисовки - меню на месте, страница говорит, что не открылась", async ({ page }) => {
  // A summary without its fields throws while rendering the metrics page.
  await mockApi(page, (route, path) => (path === "/api/metrics/summary" ? route.fulfill({ json: {} }) : undefined));
  await page.goto("/metrics");
  await expect(page.getByText("Страница не открылась")).toBeVisible();
  // The browser's English text is a detail for a bug report, not the message.
  await expect(page.locator(".ant-result-subtitle")).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Компании" })).toBeVisible();
  // Another section renders normally: the boundary resets on navigation.
  await page.getByRole("menuitem", { name: "Компании" }).click();
  await expect(page.getByText("Страница не открылась")).toHaveCount(0);
});

test("модуль страницы не загрузился - просьба обновить страницу", async ({ page }) => {
  await mockApi(page);
  await page.route("**/assets/MetricsPage-*.js", (route) => route.abort("failed"));
  await page.goto("/companies");
  await page.getByRole("menuitem", { name: "Метрики" }).click();
  // After a redeploy or a dropped link alike: the browser does not say which.
  await expect(page.getByText("Не удалось загрузить часть приложения - обновите страницу")).toBeVisible();
  await expect(page.getByRole("button", { name: "Обновить" })).toBeVisible();
});

test("Excel не выгрузился - пользователь видит сообщение", async ({ page }) => {
  await mockApi(page, (route, path) => (path === "/api/companies" ? route.fulfill({ json: [company] }) : undefined));
  await page.route("**/assets/exceljs*.js", (route) => route.abort("failed"));
  await page.goto("/companies");
  await page.getByRole("button", { name: /Excel/ }).click();
  await expect(page.locator(".ant-message", { hasText: "Не удалось выгрузить Excel" })).toBeVisible();
});

test("ошибка валидации формы не всплывает как «Неизвестная ошибка»", async ({ page }) => {
  await mockApi(page);
  await page.goto("/admin/users");
  await page.getByRole("button", { name: /Добавить/ }).click();
  await page.getByRole("button", { name: "Сохранить" }).click();
  // The form marks its own empty fields; that is not a failure to report.
  await expect(page.getByText("Введите логин")).toBeVisible();
  // A toast lives 3 s: look once, right away, without waiting for it to go.
  await page.waitForTimeout(500);
  expect(await page.locator(".ant-message-notice").count()).toBe(0);
});
