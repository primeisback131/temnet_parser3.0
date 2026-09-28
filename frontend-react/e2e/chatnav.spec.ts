import { expect, test, type Page } from "@playwright/test";

// From a metric drill-down into the chat. Before 2026-09-28 a client link
// opened the conversation at its first message of the period (u96.medeor:
// a Wednesday 13:03 question on the "off hours" card), and nothing led from
// one event of the metric to the next.

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

/** Metrics everywhere, chats only for Медеор. */
const medeorOnly = {
  ...admin,
  username: "boss",
  role: "manager",
  unrestricted: false,
  metricsGroups: ["Медеор", "Дельта"],
  chatGroups: ["Медеор"],
};

const zeros = Object.fromEntries(
  ["opened", "closed", "rejected", "expired", "stillOpen", "unanswered", "answered", "answeredFast", "answeredHour",
    "resolved", "resolvedHour", "resolvedDay", "inProgress", "thanked", "replies", "replySeconds", "handoffs",
    "clients", "newClients", "incoming", "offHours"].map((k) => [k, 0]),
);

const msg = (client: string, direction: "in" | "out", createdAt: string, message: string) => ({
  client,
  sender: direction === "in" ? client : "help-1",
  recipient: direction === "in" ? "help-1" : client,
  direction,
  message,
  createdAt,
});

// Forty daytime messages first: the chat has to scroll to reach the event.
const daytime = Array.from({ length: 40 }, (_, i) =>
  msg("u96.medeor", i % 2 ? "out" : "in", `2026-01-${String(5 + Math.floor(i / 4)).padStart(2, "0")}T1${i % 4}:00:00`, `днём ${i}`),
);

/** client -> [group, conversation] */
const chats: Record<string, [string, object[]]> = {
  "u96.medeor": [
    "Медеор",
    [
      ...daytime,
      msg("u96.medeor", "in", "2026-01-21T13:03:19", "дневной вопрос"),
      msg("u96.medeor", "out", "2026-01-21T13:10:00", "дневной ответ"),
      msg("u96.medeor", "in", "2026-01-21T20:10:00", "ночной вопрос"),
      msg("u96.medeor", "in", "2026-01-21T20:20:00", "ещё ночью"),
      msg("u96.medeor", "out", "2026-01-22T09:00:00", "утренний ответ"),
      msg("u96.medeor", "in", "2026-01-24T11:00:00", "в субботу"),
    ],
  ],
  "u50.delta": ["Дельта", [msg("u50.delta", "in", "2026-01-23T23:00:00", "дельта ночью")]],
  "u70.medeor": ["Медеор", [msg("u70.medeor", "in", "2026-01-22T22:00:00", "поздний вопрос")]],
  "u3.expired": [
    "Медеор",
    [
      msg("u3.expired", "in", "2026-02-02T10:00:00", "принтер не печатает"),
      msg("u3.expired", "out", "2026-02-02T10:30:00", "перезагрузите"),
      msg("u3.expired", "in", "2026-02-05T15:03:00", "так и не печатает"),
    ],
  ],
  "u4.silent": [
    "Медеор",
    [
      msg("u4.silent", "in", "2026-02-03T10:00:00", "первая заявка"),
      msg("u4.silent", "out", "2026-02-03T10:05:00", "ответили"),
      msg("u4.silent", "in", "2026-02-06T10:04:00", "вторая без ответа"),
    ],
  ],
  "u5.open": ["Медеор", [msg("u5.open", "in", "2025-12-20T10:05:00", "старая открытая")]],
  "u1.closed": ["Медеор", [msg("u1.closed", "in", "2026-02-02T10:00:00", "вопрос"), msg("u1.closed", "out", "2026-02-03T12:01:00", "заявка закрыта")]],
  "u2.rejected": ["Медеор", [msg("u2.rejected", "out", "2026-02-04T12:02:00", "заявка отклонена")]],
};

const ticket = (client: string, status: string, times: Record<string, string>, extra: object = {}) => ({
  client,
  groupNames: "Медеор",
  openedAt: "2026-02-02T10:00:00",
  lastActivity: "2026-02-02T15:00:00",
  closedAt: status === "closed" || status === "rejected" ? "2026-02-02T12:00:00" : null,
  status,
  category: "Принтеры",
  messagesIn: 3,
  messagesOut: 2,
  firstResponder: "help-1",
  frtSeconds: 1800,
  closedBy: status === "closed" || status === "rejected" ? "help-1" : null,
  resolutionSeconds: status === "closed" ? 7200 : null,
  noReply: false,
  awaiting: false,
  thanked: false,
  reopened: false,
  answered: true,
  answeredFast: false,
  answeredHour: true,
  resolved: status === "closed",
  resolvedHour: false,
  resolvedDay: status === "closed",
  ...times,
  ...extra,
});

// One ticket per card, each with its own anchor moment; u4.silent also has an
// answered ticket, a row of the "Без ответа" drawer that is not an event.
const tickets = [
  ticket("u1.closed", "closed", { closedAt: "2026-02-03T12:01:00" }, { thanked: true }),
  ticket("u2.rejected", "rejected", { closedAt: "2026-02-04T12:02:00" }),
  ticket("u3.expired", "expired", { lastActivity: "2026-02-05T15:03:00" }),
  ticket("u4.silent", "closed", { openedAt: "2026-02-03T10:00:00", closedAt: "2026-02-03T10:05:00" }, { answeredFast: true }),
  ticket("u4.silent", "expired", { openedAt: "2026-02-06T10:04:00" }, { noReply: true, answered: false, frtSeconds: null, firstResponder: null }),
];

async function mockApi(page: Page, me: object = admin) {
  // Mocked on the whole context: the chat opens in a new tab.
  await page.context().route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const q = (k: string) => url.searchParams.get(k);
    const inGroup = (client: string) => chats[client]?.[0] === q("groupName");
    const one = (list: typeof tickets) => (q("client") ? list.filter((t) => t.client === q("client")) : list);
    const answers: Record<string, unknown> = {
      "/api/auth/me": me,
      "/api/metrics/summary": { ...zeros, avgPickupSeconds: null, avgMessages: null, p50Messages: null, p90Messages: null },
      "/api/metrics/backlog": { asOf: null, openTickets: 0, ageDay: 0, ageThreeDays: 0, ageWeek: 0, ageMonth: 0, ageOlder: 0, oldestOpenedAt: null },
      "/api/metrics/alerts": { asOf: null, weekStart: null, alerts: [] },
      "/api/metrics/clients/messages": [
        { client: "u96.medeor", groupNames: "Медеор", messagesIn: 25, messagesOut: 21, offHoursNight: 2, offHoursWeekend: 1 },
        { client: "u50.delta", groupNames: "Дельта", messagesIn: 1, messagesOut: 0, offHoursNight: 1, offHoursWeekend: 0 },
        { client: "u70.medeor", groupNames: "Медеор", messagesIn: 1, messagesOut: 0, offHoursNight: 1, offHoursWeekend: 0 },
      ],
      // u96.medeor: two runs (20:10 and 20:20 are one); the others one each.
      "/api/metrics/messages/off-hours": [
        { client: "u96.medeor", groupNames: "Медеор", at: "2026-01-21T20:10:00" },
        { client: "u96.medeor", groupNames: "Медеор", at: "2026-01-21T20:20:00" },
        { client: "u96.medeor", groupNames: "Медеор", at: "2026-01-24T11:00:00" },
        { client: "u50.delta", groupNames: "Дельта", at: "2026-01-23T23:00:00" },
        { client: "u70.medeor", groupNames: "Медеор", at: "2026-01-22T22:00:00" },
      ],
      "/api/metrics/tickets/opened": { tickets: one(tickets), truncated: false },
      "/api/metrics/tickets/closed": { tickets: one(tickets.filter((t) => t.closedAt)), truncated: false },
      "/api/metrics/backlog/tickets": [
        { ...ticket("u5.open", "open", { openedAt: "2025-12-20T10:05:00" }), ageDays: 70, finalStatus: "open", closedAt: null },
      ],
      "/api/groups": [{ groupName: "Медеор" }, { groupName: "Дельта" }],
      "/api/chat/chatlist": Object.keys(chats)
        .filter(inGroup)
        .map((client) => ({ client, lastAt: "2026-01-24T11:00:00", messages: 1, lastText: "…", lastDirection: "in" })),
      "/api/chat/tickets": [],
      "/api/chat": inGroup(q("user") ?? "") ? chats[q("user")!][1] : [],
    };
    return route.fulfill({ json: answers[path] ?? [] });
  });
}

test.beforeEach(async ({ page }) => {
  // The page's default period is Jan 1 to today; the fixtures are 2026.
  await page.context().clock.setFixedTime(new Date("2026-03-01T12:00:00"));
});

/** Opens a card's drawer as one flat list. */
async function openList(page: Page, card: string) {
  await page.locator(".stat-card", { hasText: card }).click();
  const drawer = page.locator(".ant-drawer-content");
  await page.mouse.move(0, 0);
  await drawer.getByText("Одним списком").click();
  return drawer;
}

/** Follows a client's link from the drawer into the chat tab. */
async function openChat(page: Page, drawer: ReturnType<Page["locator"]>, client: string) {
  const [chat] = await Promise.all([page.waitForEvent("popup"), drawer.getByRole("link", { name: client }).click()]);
  return chat;
}

test("вне рабочего времени: чат встаёт на ночную серию, дальше - следующая и следующий клиент", async ({ page }) => {
  await mockApi(page);
  await page.goto("/metrics");
  const chat = await openChat(page, await openList(page, "Вне рабочего времени"), "u96.medeor");

  const current = chat.locator(".msg-row.current");
  const position = chat.locator(".chat-nav-pos");
  await expect(current).toContainText("ночной вопрос");
  // Forty messages above it: in view only if the chat scrolled there.
  await expect(current).toBeInViewport();
  await expect(position).toHaveText("1 из 2");

  await chat.getByRole("button", { name: "Следующее событие" }).click();
  await expect(current).toContainText("в субботу");
  await expect(position).toHaveText("2 из 2");

  // The next client is in another group: the chat switches to it.
  await chat.getByRole("button", { name: "Следующий клиент" }).click();
  await expect(chat.locator(".chat-conversation-header")).toContainText("u50.delta");
  await expect(current).toContainText("дельта ночью");
  await expect(chat).toHaveURL(/group=%D0%94%D0%B5%D0%BB%D1%8C%D1%82%D0%B0/);

  await chat.getByRole("button", { name: "Следующий клиент" }).click();
  await expect(chat.locator(".chat-conversation-header")).toContainText("u70.medeor");
  await expect(current).toContainText("поздний вопрос");
  await expect(position).toHaveText("1 из 1");
});

test("следующий клиент пропускает группы без доступа к чатам", async ({ page }) => {
  await mockApi(page, medeorOnly);
  await page.goto("/metrics");
  const chat = await openChat(page, await openList(page, "Вне рабочего времени"), "u96.medeor");
  await expect(chat.locator(".msg-row.current")).toContainText("ночной вопрос");
  await chat.getByRole("button", { name: "Следующий клиент" }).click();
  await expect(chat.locator(".chat-conversation-header")).toContainText("u70.medeor");
});

test("истекла по тишине: чат встаёт на последнее сообщение перед тишиной", async ({ page }) => {
  await mockApi(page);
  await page.goto("/metrics");
  const chat = await openChat(page, await openList(page, "Истекли по тишине"), "u3.expired");
  await expect(chat.locator(".msg-row.current")).toContainText("так и не печатает");
  await expect(chat.locator(".chat-nav-pos")).toHaveText("1 из 1");
});

test("событие после конца периода: период чата расширяется до него", async ({ page }) => {
  await mockApi(page);
  // The card's period ends on Feb 4; the ticket went silent on Feb 5.
  await page.goto(
    "/chat?group=%D0%9C%D0%B5%D0%B4%D0%B5%D0%BE%D1%80&user=u3.expired&start=2026-02-01&end=2026-02-04&metric=expired&at=2026-02-05T15:03:00",
  );
  await expect(page.locator(".msg-row.current")).toContainText("так и не печатает");
  await expect(page).toHaveURL(/[?&]end=2026-02-05/);
});

test("открытая заявка старше периода: период чата расширяется назад", async ({ page }) => {
  await mockApi(page);
  await page.goto("/metrics");
  const chat = await openChat(page, await openList(page, "Открытых заявок"), "u5.open");
  await expect(chat.locator(".msg-row.current")).toContainText("старая открытая");
  await expect(chat).toHaveURL(/[?&]start=2025-12-20/);
});

test("строка вне списка событий: шаги идут по времени", async ({ page }) => {
  await mockApi(page);
  await page.goto("/metrics");
  const drawer = await openList(page, "Без ответа");
  await drawer.getByText("Все", { exact: true }).click();
  // The answered ticket of u4.silent (Feb 3) is a row but not an event.
  const links = drawer.getByRole("link", { name: "u4.silent" });
  const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  const row = hrefs.findIndex((h) => h.includes("at=2026-02-03T10%3A00%3A00"));
  expect(row, hrefs.join("\n")).toBeGreaterThanOrEqual(0);
  const [chat] = await Promise.all([page.waitForEvent("popup"), links.nth(row).click()]);
  await expect(chat.locator(".msg-row.current")).toContainText("первая заявка");
  await expect(chat.locator(".chat-nav-pos")).toHaveText("вне списка, всего 1");
  await expect(chat.getByRole("button", { name: "Предыдущее событие" })).toBeDisabled();
  await chat.getByRole("button", { name: "Следующее событие" }).click();
  await expect(chat.locator(".msg-row.current")).toContainText("вторая без ответа");
  await expect(chat.locator(".chat-nav-pos")).toHaveText("1 из 1");
});

// Card, the metric its links name, a client of its list, the moment the link
// must point at (null: a client row, the chat takes the client's first event).
const anchors: [string, string, string, string | null][] = [
  ["Закрыто заявок", "closed", "u1.closed", "2026-02-03T12:01:00"],
  ["Отклонено", "rejected", "u2.rejected", "2026-02-04T12:02:00"],
  ["Истекли по тишине", "expired", "u3.expired", "2026-02-05T15:03:00"],
  ["Без ответа", "unanswered", "u4.silent", "2026-02-06T10:04:00"],
  ["Благодарностей", "thanked", "u1.closed", "2026-02-03T12:01:00"],
  ["Ответ за 15 мин", "fast", "u1.closed", "2026-02-02T10:00:00"],
  ["Решено за час", "resolved", "u1.closed", "2026-02-02T10:00:00"],
  ["Открытых заявок", "open", "u5.open", "2025-12-20T10:05:00"],
  ["Сообщений", "messages", "u96.medeor", null],
  ["Вне рабочего времени", "offHours", "u96.medeor", null],
];

test("ссылка каждой карточки ведёт на момент события своей метрики", async ({ page }) => {
  await mockApi(page);
  await page.goto("/metrics");
  for (const [card, metric, client, at] of anchors) {
    const drawer = await openList(page, card);
    const href = await drawer.getByRole("link", { name: client }).first().getAttribute("href");
    const params = new URL(href!, "http://x").searchParams;
    expect(params.get("metric"), card).toBe(metric);
    expect(params.get("at"), card).toBe(at);
    await page.locator(".ant-drawer-close").click();
    await expect(drawer).toBeHidden();
  }
});

test("сообщения: чат идёт по дням переписки", async ({ page }) => {
  await mockApi(page);
  await page.goto("/metrics");
  const chat = await openChat(page, await openList(page, "Сообщений"), "u96.medeor");
  const current = chat.locator(".msg-row.current");
  await expect(current).toContainText("днём 0");
  // Jan 5-14 (10 days of daytime messages), 21, 22 and 24.
  await expect(chat.locator(".chat-nav-pos")).toHaveText("1 из 13");
  await chat.getByRole("button", { name: "Следующее событие" }).click();
  await expect(current).toContainText("днём 4");
});
