import { FileExcelOutlined } from "@ant-design/icons";
import { Button, Card, DatePicker, Input, Space, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useCompanies } from "../api/queries";
import type { Company } from "../api/types";
import { defaultRange, toApiDate } from "../lib/date";
import { exportToExcel } from "../lib/excel";

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

export default function CompaniesPage() {
  const [[start, end], setRange] = useState(defaultRange);
  const [search, setSearch] = useState("");

  const startStr = toApiDate(start);
  const endStr = toApiDate(end);
  const { data = [], isFetching } = useCompanies(startStr, endStr);

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.trim().toLowerCase();
    return data.filter((row) =>
      Object.values(row).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [data, search]);

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
