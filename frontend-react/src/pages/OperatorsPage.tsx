import { FileExcelOutlined } from "@ant-design/icons";
import { App, Button, Card, DatePicker, Select, Space, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useGroups, useOperators } from "../api/queries";
import type { OperatorStat } from "../api/types";
import { useAuth } from "../auth";
import QueryError from "../components/QueryError";
import { defaultRange, toApiDate } from "../lib/date";
import { humanizeSeconds } from "../lib/format";
import { exportHelpReport } from "../lib/helpReport";

const { RangePicker } = DatePicker;

/** Whole-percent share, 0 when the denominator is empty. */
const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export default function OperatorsPage() {
  const { message } = App.useApp();
  const { canExport } = useAuth();
  const [[start, end], setRange] = useState(defaultRange);
  const [group, setGroup] = useState<string | null>(null);
  /** Operator whose report is being built; one at a time keeps the toasts readable. */
  const [exporting, setExporting] = useState<string | null>(null);

  const startStr = toApiDate(start);
  const endStr = toApiDate(end);

  const { data: groups = [], error: groupsError } = useGroups();
  const { data = [], isFetching, error } = useOperators(startStr, endStr, group);

  const maxClosed = useMemo(() => data.reduce((m, o) => Math.max(m, o.closed), 0), [data]);

  const columns: ColumnsType<OperatorStat> = useMemo(
    () => [
      {
        title: "Оператор",
        dataIndex: "operator",
        sorter: (a, b) => a.operator.localeCompare(b.operator),
      },
      {
        title: "Закрыто заявок",
        dataIndex: "closed",
        defaultSortOrder: "descend",
        sorter: (a, b) => a.closed - b.closed,
        width: 200,
        // The bar turns the column into a ranking you can read at a glance.
        render: (v: number) => (
          <span className="bar-cell">
            <span className="bar-cell-value">{v.toLocaleString("ru-RU")}</span>
            <span className="bar-cell-track">
              <span
                className="bar-cell-fill"
                style={{ width: `${maxClosed > 0 ? (v / maxClosed) * 100 : 0}%` }}
              />
            </span>
          </span>
        ),
      },
      { title: "Отклонено", dataIndex: "rejected", sorter: (a, b) => a.rejected - b.rejected },
      {
        title: (
          <Tooltip title="Доля закрытых этим оператором заявок, после которых клиент вернулся с той же проблемой">
            Вернулись
          </Tooltip>
        ),
        dataIndex: "reopened",
        sorter: (a, b) => share(a.reopened, a.closed) - share(b.reopened, b.closed),
        render: (v: number, row) => (row.closed > 0 ? `${v} (${share(v, row.closed)}%)` : "-"),
      },
      {
        title: (
          <Tooltip title="Закрытия, на которые клиент ответил благодарностью в течение 4 рабочих часов">
            Благодарностей
          </Tooltip>
        ),
        dataIndex: "thanked",
        sorter: (a, b) => share(a.thanked, a.closed) - share(b.thanked, b.closed),
        render: (v: number, row) => (row.closed > 0 ? `${v} (${share(v, row.closed)}%)` : "-"),
      },
      { title: "Сообщений", dataIndex: "messages", sorter: (a, b) => a.messages - b.messages },
      { title: "Клиентов", dataIndex: "clients", sorter: (a, b) => a.clients - b.clients },
      {
        title: (
          <Tooltip title="Рабочее время от открытия обращения до первого ответа, по заявкам, где первым ответил этот оператор">
            Ср. первый ответ
          </Tooltip>
        ),
        dataIndex: "avgReplySeconds",
        sorter: (a, b) => (a.avgReplySeconds ?? Infinity) - (b.avgReplySeconds ?? Infinity),
        render: (v: number | null) => humanizeSeconds(v),
      },
      ...(canExport
        ? [
            {
              title: "",
              key: "report",
              width: 48,
              render: (_: unknown, row: OperatorStat) => (
                <Tooltip title="Отчёт по аккаунту в Excel за выбранный период: сводка по его группам и лист на каждую группу. Период больше месяца выгружается zip-архивом по месяцам">
                  <Button
                    size="small"
                    type="text"
                    icon={<FileExcelOutlined />}
                    loading={exporting === row.operator}
                    disabled={exporting !== null && exporting !== row.operator}
                    onClick={async () => {
                      setExporting(row.operator);
                      try {
                        await exportHelpReport(message, start, end, row.operator);
                      } finally {
                        setExporting(null);
                      }
                    }}
                  />
                </Tooltip>
              ),
            },
          ]
        : []),
    ],
    [maxClosed, canExport, exporting, message, start, end],
  );

  return (
    <Card>
      <div className="table-toolbar">
        <Space wrap size={12}>
          <RangePicker
            value={[start, end]}
            onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
            allowClear={false}
          />
          <Select
            showSearch
            allowClear
            placeholder="Все группы"
            style={{ width: 240 }}
            value={group ?? undefined}
            onChange={(v) => setGroup(v ?? null)}
            options={groups.map((g) => ({ value: g.groupName, label: g.groupName }))}
          />
        </Space>
        <span className="meta">{data.length} операторов</span>
      </div>
      <QueryError error={groupsError ?? error} />
      <Table
        rowKey="operator"
        columns={columns}
        dataSource={data}
        loading={isFetching}
        size="middle"
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: true }}
      />
    </Card>
  );
}
