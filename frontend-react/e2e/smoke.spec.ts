import { expect, test, type Page } from "@playwright/test";

// Did the page render at all, with a clean console? A green `tsc` and a green
// Vite build say nothing about that. The API is mocked, mostly with empty data
// (the metric drill-downs get a few rows): the test checks the rendering path,
// not the numbers.

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

// Rows behind the metric cards: two organizations and a client without one,
// so the drill-downs render their per-organization split.
const ticket = (client: string, groupNames: string | null, status: string, extra: object = {}) => ({
  client,
  groupNames,
  openedAt: "2026-08-03T09:10:00",
  lastActivity: "2026-08-03T11:00:00",
  closedAt: status === "closed" || status === "rejected" ? "2026-08-03T10:40:00" : null,
  status,
  category: "Принтеры",
  messagesIn: 3,
  messagesOut: 2,
  firstResponder: "help-1",
  frtSeconds: 600,
  closedBy: status === "closed" || status === "rejected" ? "help-1" : null,
  resolutionSeconds: status === "closed" ? 5400 : null,
  noReply: false,
  awaiting: false,
  thanked: status === "closed",
  reopened: false,
  answered: true,
  answeredFast: true,
  answeredHour: true,
  resolved: status === "closed",
  resolvedHour: false,
  resolvedDay: status === "closed",
  ...extra,
});
const tickets = [
  ticket("u1.alpha", "Альфа", "closed"),
  ticket("u2.alpha", "Альфа", "expired", { noReply: true, firstResponder: null, frtSeconds: null, answered: false }),
  ticket("u1.beta", "Бета", "rejected", { openedAt: "2026-08-04T20:00:00" }),
  ticket("u2.beta", "Бета", "open", { frtSeconds: 2400, answeredFast: false }),
  ticket("stray", null, "expired", { awaiting: true }),
];
const lists: Record<string, unknown> = {
  "/api/metrics/tickets/opened": { tickets, truncated: false },
  "/api/metrics/tickets/closed": { tickets: tickets.filter((t) => t.closedAt), truncated: false },
  "/api/metrics/clients/messages": [
    { client: "u1.alpha", groupNames: "Альфа", messagesIn: 12, messagesOut: 9, offHoursNight: 2, offHoursWeekend: 1 },
    { client: "u1.beta", groupNames: "Бета", messagesIn: 4, messagesOut: 5, offHoursNight: 0, offHoursWeekend: 0 },
  ],
  "/api/metrics/backlog/tickets": [
    { ...ticket("u2.beta", "Бета", "open"), ageDays: 2, finalStatus: "closed", closedAt: "2026-08-05T10:00:00" },
  ],
};

async function mockApi(page: Page, me: unknown | null) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") {
      return me
        ? route.fulfill({ json: me })
        : route.fulfill({ status: 401, json: { message: "Требуется вход" } });
    }
    return route.fulfill({ json: objects[path] ?? lists[path] ?? [] });
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

// Card, the title of the drawer it opens, a client in that drawer's default list.
const cards: [string, string, string][] = [
  ["Сообщений", "Сообщения", "u1.alpha"],
  ["Закрыто заявок", "Закрытые заявки", "u1.alpha"],
  ["Отклонено", "Отклонённые заявки", "u1.beta"],
  ["Открытых заявок", "Открытые заявки на", "u2.beta"],
  ["Без ответа", "Без ответа", "u2.alpha"],
  ["Истекли по тишине", "Истекли по тишине", "u2.alpha"],
  ["Ответ за 15 мин", "Первый ответ за 15 мин", "u2.beta"],
  ["Решено за час", "Решено за час", "u1.alpha"],
  ["Благодарностей", "Благодарности", "u1.alpha"],
  ["Вне рабочего времени", "Вне рабочего времени", "u1.alpha"],
];

test("каждая карточка метрик открывает свою детализацию по организациям", async ({ page }) => {
  const errors = watchConsole(page);
  await mockApi(page, admin);
  await page.goto("/metrics");
  for (const [card, title, client] of cards) {
    await page.locator(".stat-card", { hasText: card }).click();
    const drawer = page.locator(".ant-drawer-content");
    await expect(drawer.locator(".ant-drawer-title")).toContainText(title);
    // "All groups" is selected, so the rows are split by organization.
    await expect(drawer.getByRole("cell", { name: /^(Альфа|Бета)$/ }).first()).toBeVisible();
    // The flat list renders the card's own ticket columns. The pointer is
    // moved off the table first: a header's sort tooltip covers the switch.
    await page.mouse.move(0, 0);
    await drawer.getByText("Одним списком").click();
    await expect(drawer.getByRole("link", { name: client })).toBeVisible();
    await page.locator(".ant-drawer-close").click();
    await expect(drawer).toBeHidden();
  }
  expect(errors).toEqual([]);
});
