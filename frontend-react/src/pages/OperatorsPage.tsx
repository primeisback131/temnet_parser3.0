import { Card, DatePicker, Select, Space, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useGroups, useOperators } from "../api/queries";
import type { OperatorStat } from "../api/types";
import QueryError from "../components/QueryError";
import { defaultRange, toApiDate } from "../lib/date";
import { humanizeSeconds } from "../lib/format";

const { RangePicker } = DatePicker;

const columns: ColumnsType<OperatorStat> = [
  {
    title: "Оператор",
    dataIndex: "operator",
    sorter: (a, b) => a.operator.localeCompare(b.operator),
    render: (v: string) => <Tag color="blue">{v}</Tag>,
  },
  {
    title: "Закрыто заявок",
    dataIndex: "closed",
    defaultSortOrder: "descend",
    sorter: (a, b) => a.closed - b.closed,
  },
  { title: "Отклонено", dataIndex: "rejected", sorter: (a, b) => a.rejected - b.rejected },
  { title: "Сообщений", dataIndex: "messages", sorter: (a, b) => a.messages - b.messages },
  { title: "Клиентов", dataIndex: "clients", sorter: (a, b) => a.clients - b.clients },
  {
    title: (
      <Tooltip title="Среднее рабочее время от открытия обращения до первого ответа, по заявкам, где первым ответил этот оператор.">
        Ср. первый ответ
      </Tooltip>
    ),
    dataIndex: "avgReplySeconds",
    sorter: (a, b) => (a.avgReplySeconds ?? Infinity) - (b.avgReplySeconds ?? Infinity),
    render: (v: number | null) => humanizeSeconds(v),
  },
];

export default function OperatorsPage() {
  const [[start, end], setRange] = useState(defaultRange);
  const [group, setGroup] = useState<string | null>(null);

  const startStr = toApiDate(start);
  const endStr = toApiDate(end);

  const { data: groups = [], error: groupsError } = useGroups();
  const { data = [], isFetching, error } = useOperators(startStr, endStr, group);

  return (
    <Card>
      <Space style={{ marginBottom: 16 }} wrap size={12}>
        <RangePicker
          value={[start, end]}
          onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
          allowClear={false}
        />
        <Select
          showSearch
          allowClear
          placeholder="Все группы (по клиентам)"
          style={{ width: 240 }}
          value={group ?? undefined}
          onChange={(v) => setGroup(v ?? null)}
          options={groups.map((g) => ({ value: g.groupName, label: g.groupName }))}
        />
      </Space>
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
