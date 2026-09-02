import { Card, DatePicker, Select, Space, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useGroups, useOperators } from "../api/queries";
import type { OperatorStat } from "../api/types";
import { defaultRange, toApiDate } from "../lib/date";
import { humanizeSeconds } from "../lib/format";

const { RangePicker } = DatePicker;

export default function OperatorsPage() {
  const [[start, end], setRange] = useState(defaultRange);
  const [group, setGroup] = useState<string | null>(null);

  const startStr = toApiDate(start);
  const endStr = toApiDate(end);

  const { data: groups = [] } = useGroups();
  const { data = [], isFetching } = useOperators(startStr, endStr, group);

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
    ],
    [maxClosed],
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
      <Table
        rowKey="operator"
        columns={columns}
        dataSource={data}
        loading={isFetching}
        size="middle"
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />
    </Card>
  );
}
