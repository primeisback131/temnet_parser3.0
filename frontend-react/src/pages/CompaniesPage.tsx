import { FileExcelOutlined } from "@ant-design/icons";
import { App, Button, Card, DatePicker, Input, Select, Space, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { api } from "../api/client";
import { useCompanies, useHelpAccounts } from "../api/queries";
import type { Company, HelpAccountReport } from "../api/types";
import { defaultRange, monthlyRanges, toApiDate } from "../lib/date";
import {
  exportToExcel,
  exportWorkbook,
  exportWorkbooksZip,
  safeSheetName,
  type SheetSpec,
  type WorkbookFile,
} from "../lib/excel";

const { RangePicker } = DatePicker;

const columns: ColumnsType<Company> = [
  { title: "Имя группы", dataIndex: "groupName", sorter: (a, b) => a.groupName.localeCompare(b.groupName) },
  { title: "Активные пользователи", dataIndex: "activeUsers", sorter: (a, b) => a.activeUsers - b.activeUsers },
  { title: "Всего пользователей", dataIndex: "totalUsers", sorter: (a, b) => a.totalUsers - b.totalUsers },
  { title: "Закрытых заявок", dataIndex: "closedRequests", sorter: (a, b) => a.closedRequests - b.closedRequests },
  { title: "Отклоненных заявок", dataIndex: "rejectedRequests", sorter: (a, b) => a.rejectedRequests - b.rejectedRequests },
  { title: "Заявок в работе", dataIndex: "requestsInProgress", sorter: (a, b) => a.requestsInProgress - b.requestsInProgress },
  { title: "Всего сообщений", dataIndex: "totalMessages", sorter: (a, b) => a.totalMessages - b.totalMessages },
];

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

export default function CompaniesPage() {
  const { message } = App.useApp();
  const [[start, end], setRange] = useState(defaultRange);
  const [search, setSearch] = useState("");
  const [helpAccount, setHelpAccount] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const startStr = toApiDate(start);
  const endStr = toApiDate(end);
  const { data = [], isFetching } = useCompanies(startStr, endStr);
  const { data: helpAccounts = [] } = useHelpAccounts();

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.trim().toLowerCase();
    return data.filter((row) =>
      Object.values(row).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [data, search]);

  const exportHelpReport = async () => {
    if (!helpAccount) return;
    setExporting(true);
    const progressKey = "help-report-progress";
    try {
      const ranges = monthlyRanges(start, end);

      // Up to one month — a single workbook, as before.
      if (ranges.length === 1) {
        const report = await api.getHelpAccountReport(startStr, endStr, helpAccount);
        if (report.users.length === 0) {
          message.info(`Нет данных по аккаунту ${helpAccount} за выбранный период`);
          return;
        }
        await exportWorkbook(helpReportSheets(report), `help_${helpAccount}_${startStr}_${endStr}.xlsx`);
        return;
      }

      // Longer periods — one workbook per calendar month, zipped together.
      const files: WorkbookFile[] = [];
      for (let i = 0; i < ranges.length; i++) {
        const [monthStart, monthEnd] = ranges[i];
        message.open({
          key: progressKey,
          type: "loading",
          content: `Формирование отчёта: месяц ${i + 1} из ${ranges.length}`,
          duration: 0,
        });
        const report = await api.getHelpAccountReport(
          toApiDate(monthStart),
          toApiDate(monthEnd),
          helpAccount,
        );
        if (report.users.length > 0) {
          files.push({
            name: `help_${helpAccount}_${monthStart.format("YYYY-MM")}.xlsx`,
            sheets: helpReportSheets(report),
          });
        }
      }
      if (files.length === 0) {
        message.open({
          key: progressKey,
          type: "info",
          content: `Нет данных по аккаунту ${helpAccount} за выбранный период`,
          duration: 3,
        });
        return;
      }
      await exportWorkbooksZip(files, `help_${helpAccount}_${startStr}_${endStr}.zip`);
      message.open({
        key: progressKey,
        type: "success",
        content: `Архив сформирован: отчётов за месяцы — ${files.length}`,
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
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }} wrap>
        <Input.Search
          placeholder="Поиск группы"
          allowClear
          style={{ width: 240 }}
          onChange={(e) => setSearch(e.target.value)}
        />
        <RangePicker
          value={[start, end]}
          onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
          allowClear={false}
        />
        <Space wrap>
          <Select
            placeholder="Help-аккаунт"
            allowClear
            showSearch
            style={{ width: 200 }}
            value={helpAccount}
            onChange={(v) => setHelpAccount(v ?? null)}
            options={helpAccounts.map((a) => ({ label: a.account, value: a.account }))}
          />
          <Tooltip title="Отчёт по всем организациям выбранного help-аккаунта: все метрики по группам (первый ответ, время решения, повторы, динамика, категории) + лист на каждую группу пользователей. За период больше месяца — zip-архив с отчётом за каждый месяц">
            <Button
              icon={<FileExcelOutlined />}
              onClick={exportHelpReport}
              loading={exporting}
              disabled={!helpAccount}
            >
              Отчёт по help
            </Button>
          </Tooltip>
          <Tooltip title="Экспорт таблицы">
            <Button
              icon={<FileExcelOutlined />}
              onClick={() => exportToExcel(filtered, `groups_${startStr}_${endStr}.xlsx`, "Группы")}
              disabled={filtered.length === 0}
            >
              Excel
            </Button>
          </Tooltip>
        </Space>
      </Space>
      <Table
        rowKey="groupName"
        columns={columns}
        dataSource={filtered}
        loading={isFetching}
        pagination={false}
        size="middle"
        scroll={{ x: true }}
      />
    </Card>
  );
}
