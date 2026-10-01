import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

// "Все чаты" gave one sheet for the whole group and period. Since 2026-10-01:
// a sheet per client, and a period over several months - a zip of monthly
// workbooks.

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

const msg = (client: string, createdAt: string) => ({
  client,
  sender: client,
  recipient: "help-1",
  direction: "in",
  message: `${client} ${createdAt}`,
  createdAt,
});

// Two logins that share their first 31 characters: one sheet tab gets "~2".
const longA = "very-long-client-login-number-0001.medeor";
const longB = "very-long-client-login-number-0002.medeor";
const messages = [
  msg("u10.medeor", "2025-12-20T10:00:00"),
  msg("u2.medeor", "2025-12-21T10:00:00"),
  msg("u2.medeor", "2025-12-22T10:00:00"),
  msg("u2.medeor", "2026-01-31T23:59:00"),
  // February: nothing.
  msg(longA, "2026-03-02T10:00:00"),
  msg(longB, "2026-03-03T10:00:00"),
  msg("u2.medeor", "2026-03-11T10:00:00"), // after the period
];

test("все чаты за несколько месяцев - архив по месяцам, в файле лист на клиента", async ({ page }) => {
  const requested: string[] = [];
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const q = (k: string) => url.searchParams.get(k) ?? "";
    if (url.pathname === "/api/chat") {
      requested.push(`${q("start")}..${q("end")}`);
      const day = (m: { createdAt: string }) => m.createdAt.slice(0, 10);
      return route.fulfill({ json: messages.filter((m) => day(m) >= q("start") && day(m) <= q("end")) });
    }
    const answers: Record<string, unknown> = {
      "/api/auth/me": admin,
      "/api/groups": [{ groupName: "Медеор" }],
    };
    return route.fulfill({ json: answers[url.pathname] ?? [] });
  });
  await page.goto("/chat?group=Медеор&start=2025-12-15&end=2026-03-10");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Все чаты/ }).click(),
  ]);

  expect(requested).toEqual([
    "2025-12-15..2025-12-31",
    "2026-01-01..2026-01-31",
    "2026-02-01..2026-02-28",
    "2026-03-01..2026-03-10",
  ]);
  expect(download.suggestedFilename()).toBe("AllChats_Медеор_2025-12-15_2026-03-10.zip");
  await expect(page.getByText("Архив сформирован: месяцев с перепиской - 3 из 4")).toBeVisible();

  const zip = await JSZip.loadAsync(await readFile(await download.path()));
  // File -> [sheet tab, the "Клиент" column below the header], in tab order.
  const workbooks: Record<string, [string, string[]][]> = {};
  for (const name of Object.keys(zip.files).sort()) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await zip.files[name].async("arraybuffer"));
    workbooks[name] = workbook.worksheets.map((sheet) => [sheet.name, sheet.getColumn(2).values.slice(2).map(String)]);
  }

  expect(workbooks).toEqual({
    "AllChats_Медеор_2025-12.xlsx": [
      ["u2.medeor", ["u2.medeor", "u2.medeor"]],
      ["u10.medeor", ["u10.medeor"]],
    ],
    "AllChats_Медеор_2026-01.xlsx": [["u2.medeor", ["u2.medeor"]]],
    "AllChats_Медеор_2026-03.xlsx": [
      [longA.slice(0, 31), [longA]],
      [`${longA.slice(0, 28)}~2`, [longB]],
    ],
  });
});
