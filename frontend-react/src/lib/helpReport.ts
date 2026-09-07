import type { MessageInstance } from "antd/es/message/interface";
import type { Dayjs } from "dayjs";
import { api } from "../api/client";
import type { HelpAccountReport } from "../api/types";
import { monthlyRanges, toApiDate } from "./date";
import { exportWorkbook, exportWorkbooksZip, safeSheetName, type SheetSpec, type WorkbookFile } from "./excel";

/** Groups a report slice by its groupName. */
function byGroup<T extends { groupName: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.groupName) ?? [];
    list.push(row);
    map.set(row.groupName, list);
  }
  return map;
}

/**
 * Build the workbook sheets for one help account: a summary sheet with every
 * metric per group, plus one sheet per group with its users, daily dynamics
 * and request categories as separate titled sections.
 */
function helpReportSheets(report: HelpAccountReport): SheetSpec[] {
  const users = byGroup(report.users);
  const timeseries = byGroup(report.timeseries);
  const categories = byGroup(report.categories);
  const sla = new Map(report.sla.map((s) => [s.groupName, s]));
  const resolution = new Map(report.resolution.map((r) => [r.groupName, r]));
  const reopens = new Map(report.reopens.map((r) => [r.groupName, r]));

  const summary = [...users.entries()].map(([groupName, groupUsers]) => {
    const s = sla.get(groupName);
    const r = resolution.get(groupName);
    const re = reopens.get(groupName);
    return {
      Группа: groupName,
      "Активных пользователей": groupUsers.length,
      "Всего сообщений": groupUsers.reduce((acc, u) => acc + u.totalMessages, 0),
      "Закрытых заявок": groupUsers.reduce((acc, u) => acc + u.closedRequests, 0),
      "Отклоненных заявок": groupUsers.reduce((acc, u) => acc + u.rejectedRequests, 0),
      "Первый ответ: медиана, с": s ? Math.round(s.p50Seconds) : "",
      "Первый ответ: p90, с": s ? Math.round(s.p90Seconds) : "",
      "Первый ответ: среднее, с": s ? Math.round(s.avgSeconds) : "",
      "Решение: медиана, мин": r ? Math.round(r.p50Seconds / 60) : "",
      "Решение: p90, ч": r ? +(r.p90Seconds / 3600).toFixed(1) : "",
      "Решение: среднее, ч": r ? +(r.avgSeconds / 3600).toFixed(1) : "",
      "Повторные (вероятные)": re?.probable ?? 0,
      "Повторные (подтверждённые)": re?.confirmed ?? 0,
      "Повторные, % от закрытых":
        re && re.closed > 0 ? +((re.probable / re.closed) * 100).toFixed(1) : 0,
    };
  });

  const sheets: SheetSpec[] = [{ name: "Сводка по группам", rows: summary }];

  // Excel sheet names are case-INsensitive: groups like "Altair" and
  // "altair" would collide, so uniqueness is tracked in lower case.
  const usedNames = new Set(sheets.map((s) => s.name.toLowerCase()));
  for (const [groupName, groupUsers] of users) {
    let name = safeSheetName(groupName);
    for (let i = 2; usedNames.has(name.toLowerCase()); i++) {
      name = `${safeSheetName(groupName).slice(0, 28)}~${i}`;
    }
    usedNames.add(name.toLowerCase());
    sheets.push({
      name,
      sections: [
        // The exact group name as a headline: the sheet tab can be mangled
        // (31-char limit, case-collision suffixes like "altair~2").
        { title: `Группа: ${groupName}`, rows: [] },
        {
          title: "Пользователи",
          rows: groupUsers.map((u) => ({
            Пользователь: u.userName,
            "Закрытых заявок": u.closedRequests,
            "Отклоненных заявок": u.rejectedRequests,
            "Всего сообщений": u.totalMessages,
          })),
        },
        {
          title: "Динамика по дням",
          rows: (timeseries.get(groupName) ?? []).map((p) => ({
            Дата: p.bucket,
            Сообщений: p.messages,
            Закрыто: p.closed,
            Отклонено: p.rejected,
          })),
        },
        {
          title: "Категории обращений",
          rows: (categories.get(groupName) ?? []).map((c) => ({
            Категория: c.category,
            Обращений: c.requests,
          })),
        },
      ],
    });
  }
  return sheets;
}


/**
 * Download the help-account report for the range: one workbook up to a
 * month, otherwise one workbook per calendar month zipped together.
 */
export async function exportHelpReport(message: MessageInstance, start: Dayjs, end: Dayjs, account: string) {
  const startStr = toApiDate(start);
  const endStr = toApiDate(end);
  const progressKey = "help-report-progress";
  try {
    const ranges = monthlyRanges(start, end);

    if (ranges.length === 1) {
      const report = await api.getHelpAccountReport(startStr, endStr, account);
      if (report.users.length === 0) {
        message.info(`Нет данных по аккаунту ${account} за выбранный период`);
        return;
      }
      await exportWorkbook(helpReportSheets(report), `help_${account}_${startStr}_${endStr}.xlsx`);
      return;
    }

    const files: WorkbookFile[] = [];
    for (let i = 0; i < ranges.length; i++) {
      const [monthStart, monthEnd] = ranges[i];
      message.open({
        key: progressKey,
        type: "loading",
        content: `Формирование отчёта: месяц ${i + 1} из ${ranges.length}`,
        duration: 0,
      });
      const report = await api.getHelpAccountReport(toApiDate(monthStart), toApiDate(monthEnd), account);
      if (report.users.length > 0) {
        files.push({
          name: `help_${account}_${monthStart.format("YYYY-MM")}.xlsx`,
          sheets: helpReportSheets(report),
        });
      }
    }
    if (files.length === 0) {
      message.open({
        key: progressKey,
        type: "info",
        content: `Нет данных по аккаунту ${account} за выбранный период`,
        duration: 3,
      });
      return;
    }
    await exportWorkbooksZip(files, `help_${account}_${startStr}_${endStr}.zip`);
    message.open({
      key: progressKey,
      type: "success",
      content: `Архив сформирован: отчётов за месяцы - ${files.length}`,
      duration: 3,
    });
  } catch (e) {
    // Reusing the progress key replaces a hanging "loading" toast (which
    // has duration 0 and would otherwise stay on screen forever).
    message.open({
      key: progressKey,
      type: "error",
      content: e instanceof Error ? e.message : "Не удалось выгрузить отчёт",
      duration: 5,
    });
  }
}
