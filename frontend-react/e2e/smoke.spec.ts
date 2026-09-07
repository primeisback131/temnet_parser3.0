import { expect, test, type Page } from "@playwright/test";

// Did the page render at all, with a clean console? A green `tsc` and a green
// Vite build say nothing about that. The API is mocked with empty data: the
// test checks the rendering path, not the numbers.

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

const llmSettings = {
  enabled: false,
  categories: "off",
  maxPerSync: 0,
  requestsPerMinute: 0,
  ceilingIdle: 0.5,
  ceilingBusy: 0.2,
  busyWindowMinutes: 10,
  model: "",
};

// Endpoints that answer with an object; everything else answers with [].
const objects: Record<string, unknown> = {
  "/api/metrics/backlog": {
    asOf: "2026-09-01T00:00:00",
    openTickets: 0,
    ageDay: 0,
    ageThreeDays: 0,
    ageWeek: 0,
    ageMonth: 0,
    ageOlder: 0,
    oldestOpenedAt: null,
  },
  "/api/metrics/summary": {
    opened: 0,
    closed: 0,
    rejected: 0,
    expired: 0,
    stillOpen: 0,
    unanswered: 0,
    answered: 0,
    answeredFast: 0,
    answeredHour: 0,
    resolved: 0,
    resolvedHour: 0,
    resolvedDay: 0,
    inProgress: 0,
    avgPickupSeconds: null,
    thanked: 0,
    replies: 0,
    replySeconds: 0,
    avgMessages: null,
    p50Messages: null,
    p90Messages: null,
    handoffs: 0,
    clients: 0,
    newClients: 0,
    incoming: 0,
    offHours: 0,
  },
  "/api/metrics/alerts": { asOf: null, weekStart: null, alerts: [] },
  "/api/admin/sync/status": {
    last_archive_id: 0,
    last_run_at: null,
    messages_total: 0,
    tickets: [],
    reopens: 0,
    reopenLlm: [],
    syncIntervalSeconds: 3600,
    run: null,
  },
  "/api/admin/llm": {
    provider: { kind: "off", configured: false, description: "выключено" },
    settings: llmSettings,
    defaults: llmSettings,
    overriddenKeys: [],
    overrides: {},
    telemetry: {},
    stats: {
      lastRunAt: null,
      reopens: null,
      categories: null,
      totalCalls: 0,
      totalReopensDecided: 0,
      totalCategoriesDecided: 0,
      averageCallMillis: null,
      lastCallAt: null,
    },
    counters: {
      reopens: { pending: 0, same: 0, new: 0, heuristic: 0 },
      categories: {
        mode: "off",
        pending: 0,
        openOther: 0,
        otherTotal: 0,
        ticketsTotal: 0,
        classified: 0,
        byCategory: [],
      },
    },
    syncIntervalSeconds: 3600,
    run: null,
  },
};

async function mockApi(page: Page, me: unknown | null) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") {
      return me
        ? route.fulfill({ json: me })
        : route.fulfill({ status: 401, json: { message: "Требуется вход" } });
    }
    return route.fulfill({ json: objects[path] ?? [] });
  });
}

/** Uncaught exceptions and console.error calls; the browser's own 401 line is expected. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) {
      errors.push(m.text());
    }
  });
  return errors;
}

test("экран входа рендерится без сессии", async ({ page }) => {
  const errors = watchConsole(page);
  await mockApi(page, null);
  await page.goto("/");
  await expect(page.getByText("Temnet Parser")).toBeVisible();
  await expect(page.getByRole("button", { name: /войти/i })).toBeVisible();
  expect(errors).toEqual([]);
});

const pages: [string, string][] = [
  ["/chat", "Чат"],
  ["/metrics", "Метрики"],
  ["/operators", "Операторы"],
  ["/companies", "Компании"],
  ["/users", "Пользователи"],
  ["/admin/users", "Учётные записи"],
  ["/admin/maintenance", "Обслуживание"],
];

for (const [path, title] of pages) {
  test(`${path} открывается администратором`, async ({ page }) => {
    const errors = watchConsole(page);
    await mockApi(page, admin);
    await page.goto(path);
    // The menu appears only after /auth/me resolved, so the URL check below
    // runs after any client-side redirect, not before it.
    await expect(page.getByRole("menuitem", { name: title })).toBeVisible();
    // Not bounced to "home": the route exists and the rights allow it. Pages
    // keep their filters in the query string, so only the path is compared.
    await expect(page).toHaveURL(new RegExp(`^[^?]*${path}(\\?|$)`));
    // A React crash unmounts the whole tree, so the content area goes empty.
    await expect(page.locator("main")).not.toBeEmpty();
    expect(errors).toEqual([]);
  });
}
