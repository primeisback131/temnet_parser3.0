import type { MessageInstance } from "antd/es/message/interface";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { api } from "../api/client";
import type { ChatMessage } from "../api/types";
import { monthlyRanges, toApiDate } from "./date";
import { describeError } from "./errors";
import { exportWorkbook, exportWorkbooksZip, type SheetSpec, uniqueSheetName, type WorkbookFile } from "./excel";
import { compareAccountNames } from "./format";

/** Excel rows with Russian headers, like every other export. */
export function exportRows(rows: ChatMessage[]) {
  return rows.map((m) => ({
    Дата: dayjs(m.createdAt).format("DD.MM.YYYY HH:mm:ss"),
    Клиент: m.client,
    Направление: m.direction === "out" ? "ответ поддержки" : "сообщение клиента",
    Отправитель: m.sender,
    Получатель: m.recipient,
    Сообщение: m.message,
  }));
}

/**
 * One sheet per client, in account-number order. The "Клиент" column stays:
 * the sheet tab can be mangled (31-char limit, collision suffixes).
 */
function clientSheets(rows: ChatMessage[]): SheetSpec[] {
  const byClient = new Map<string, ChatMessage[]>();
  for (const m of rows) {
    const list = byClient.get(m.client) ?? [];
    list.push(m);
    byClient.set(m.client, list);
  }
  const used = new Set<string>();
  return [...byClient.keys()].sort(compareAccountNames).map((client) => ({
    name: uniqueSheetName(client, used),
    rows: exportRows(byClient.get(client)!),
  }));
}

/**
 * Download the group's correspondence for the range with a sheet per client:
 * one workbook up to a month, otherwise one workbook per calendar month
 * zipped together. Months without correspondence get no file.
 */
export async function exportGroupChats(message: MessageInstance, start: Dayjs, end: Dayjs, group: string) {
  const startStr = toApiDate(start);
  const endStr = toApiDate(end);
  const progressKey = "chats-export-progress";
  const nothing = "За выбранный период переписки нет";
  try {
    const ranges = monthlyRanges(start, end);

    if (ranges.length === 1) {
      const all = await api.getChats(startStr, endStr, group);
      if (all.length === 0) {
        message.info(nothing);
        return;
      }
      await exportWorkbook(clientSheets(all), `AllChats_${group}_${startStr}_${endStr}.xlsx`);
      return;
    }

    const files: WorkbookFile[] = [];
    for (let i = 0; i < ranges.length; i++) {
      const [monthStart, monthEnd] = ranges[i];
      message.open({
        key: progressKey,
        type: "loading",
        content: `Выгрузка переписки: месяц ${i + 1} из ${ranges.length}`,
        duration: 0,
      });
      const month = await api.getChats(toApiDate(monthStart), toApiDate(monthEnd), group);
      if (month.length > 0) {
        files.push({ name: `AllChats_${group}_${monthStart.format("YYYY-MM")}.xlsx`, sheets: clientSheets(month) });
      }
    }
    if (files.length === 0) {
      message.open({ key: progressKey, type: "info", content: nothing, duration: 3 });
      return;
    }
    await exportWorkbooksZip(files, `AllChats_${group}_${startStr}_${endStr}.zip`);
    message.open({
      key: progressKey,
      type: "success",
      content: `Архив сформирован: месяцев с перепиской - ${files.length} из ${ranges.length}`,
      duration: 3,
    });
  } catch (e) {
    // The progress key replaces a hanging "loading" toast (duration 0).
    message.open({
      key: progressKey,
      type: "error",
      content: e instanceof Error ? describeError(e) : "Не удалось выгрузить переписку",
      duration: 5,
    });
  }
}
