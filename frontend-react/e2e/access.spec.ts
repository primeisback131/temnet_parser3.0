import { expect, test, type Page } from "@playwright/test";

// A manager with metrics but without chats. Before 2026-09-28 every client
// name on the metrics page linked to /chat, and /chat quietly bounced back to
// the metrics page: the click "reloaded the page" and said nothing.

const manager = (chatGroups: string[]) => ({
  username: "boss",
  fullName: "Руководитель",
  role: "manager",
  mustChangePassword: false,
  unrestricted: false,
  metricsGroups: ["Альфа", "Бета"],
  chatGroups,
  helpAccounts: [],
});

const clientStat = (client: string, groupNames: string) => ({
  client,
  groupNames,
  tickets: 3,
  messages: 12,
  reopens: 0,
  newClient: false,
});

const summary = Object.fromEntries(
  ["opened", "closed", "rejected", "expired", "stillOpen", "unanswered", "answered", "answeredFast", "answeredHour",
    "resolved", "resolvedHour", "resolvedDay", "inProgress", "thanked", "replies", "replySeconds", "handoffs",
    "clients", "newClients", "incoming", "offHours"].map((k) => [k, 0]),
);

const closedTicket = {
  client: "u1.alpha",
  groupNames: "Альфа",
  openedAt: "2026-08-03T09:10:00",
  lastActivity: "2026-08-03T11:00:00",
  closedAt: "2026-08-03T10:40:00",
  status: "closed",
  category: "Принтеры",
  messagesIn: 3,
  messagesOut: 2,
  firstResponder: "help-1",
  frtSeconds: 600,
  closedBy: "help-1",
  resolutionSeconds: 5400,
  noReply: false,
  awaiting: false,
  thanked: false,
  reopened: false,
  answered: true,
  answeredFast: true,
  answeredHour: true,
  resolved: true,
  resolvedHour: false,
  resolvedDay: true,
};

async function mockApi(page: Page, me: object) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const answers: Record<string, unknown> = {
      "/api/auth/me": me,
      "/api/metrics/summary": { ...summary, avgPickupSeconds: null, avgMessages: null, p50Messages: null, p90Messages: null },
      "/api/metrics/backlog": { asOf: null, openTickets: 0, ageDay: 0, ageThreeDays: 0, ageWeek: 0, ageMonth: 0, ageOlder: 0, oldestOpenedAt: null },
      "/api/metrics/alerts": { asOf: null, weekStart: null, alerts: [] },
      "/api/metrics/clients": [
        clientStat("u1.alpha", "Альфа"),
        clientStat("u1.beta", "Бета"),
        clientStat("u1.both", "Альфа, Бета"),
      ],
      "/api/metrics/tickets/closed": { tickets: [closedTicket], truncated: false },
    };
    return route.fulfill({ json: answers[path] ?? [] });
  });
}

test("без доступа к чатам /chat говорит об этом, а не уводит на метрики", async ({ page }) => {
  await mockApi(page, manager([]));
  await page.goto("/chat?group=Альфа&user=u1.alpha");
  await expect(page.getByText("Нет доступа к разделу «Чат»")).toBeVisible();
  await expect(page).toHaveURL(/\/chat\?/);
});

test("имя клиента ведёт в чат только там, где чаты выданы", async ({ page }) => {
  await mockApi(page, manager(["Альфа"]));
  await page.goto("/metrics");
  const frequent = page.locator(".ant-card", { hasText: "Частые обращения" });
  await expect(frequent.getByRole("link", { name: "u1.alpha" })).toBeVisible();
  await expect(frequent.getByRole("cell", { name: "u1.beta" })).toBeVisible();
  await expect(frequent.getByRole("link", { name: "u1.beta" })).toHaveCount(0);
});

test("без доступа к чатам имена клиентов не ссылки", async ({ page }) => {
  await mockApi(page, manager([]));
  await page.goto("/metrics");
  const frequent = page.locator(".ant-card", { hasText: "Частые обращения" });
  await expect(frequent.getByRole("cell", { name: "u1.alpha" })).toBeVisible();
  await expect(frequent.getByRole("link")).toHaveCount(0);
});

test("без доступа к чатам в детализации карточки имя клиента не ссылка", async ({ page }) => {
  await mockApi(page, manager([]));
  await page.goto("/metrics");
  await page.locator(".stat-card", { hasText: "Закрыто заявок" }).click();
  const drawer = page.locator(".ant-drawer-content");
  await page.mouse.move(0, 0);
  await drawer.getByText("Одним списком").click();
  await expect(drawer.getByRole("cell", { name: "u1.alpha" })).toBeVisible();
  await expect(drawer.getByRole("link")).toHaveCount(0);
});

test("клиент нескольких групп ведёт в чат той, где чаты выданы", async ({ page }) => {
  await mockApi(page, manager(["Бета"]));
  await page.goto("/metrics");
  const frequent = page.locator(".ant-card", { hasText: "Частые обращения" });
  // groupNames is sorted, "Альфа" comes first; the grant is on "Бета".
  const link = frequent.getByRole("link", { name: "u1.both" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", /group=%D0%91%D0%B5%D1%82%D0%B0/);
});
