import { FileExcelOutlined } from "@ant-design/icons";
import { Button, Card, DatePicker, Input, Space, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useCompanies } from "../api/queries";
import type { Company } from "../api/types";
import { useAuth } from "../auth";
import QueryError from "../components/QueryError";
import { defaultRange, toApiDate } from "../lib/date";
import { exportToExcel } from "../lib/excel";

const { RangePicker } = DatePicker;

/** Tickets of the period per active member of the group. */
const perActive = (c: Company) =>
  c.activeUsers > 0 ? (c.closedRequests + c.rejectedRequests + c.openRequests) / c.activeUsers : 0;

const columns: ColumnsType<Company> = [
  { title: "Имя группы", dataIndex: "groupName", sorter: (a, b) => a.groupName.localeCompare(b.groupName) },
  { title: "Активные пользователи", dataIndex: "activeUsers", sorter: (a, b) => a.activeUsers - b.activeUsers },
  { title: "Всего пользователей", dataIndex: "totalUsers", sorter: (a, b) => a.totalUsers - b.totalUsers },
  { title: "Закрытых заявок", dataIndex: "closedRequests", sorter: (a, b) => a.closedRequests - b.closedRequests },
  { title: "Отклоненных заявок", dataIndex: "rejectedRequests", sorter: (a, b) => a.rejectedRequests - b.rejectedRequests },
  { title: "Открытых на конец периода", dataIndex: "openRequests", sorter: (a, b) => a.openRequests - b.openRequests },
  { title: "Всего сообщений", dataIndex: "totalMessages", sorter: (a, b) => a.totalMessages - b.totalMessages },
  {
    title: (
      <Tooltip title="Закрытые, отклонённые и открытые заявки на одного активного пользователя. Сравнивает нагрузку групп разного размера">
        Заявок на активного
      </Tooltip>
    ),
    key: "perActive",
    sorter: (a, b) => perActive(a) - perActive(b),
    render: (_: unknown, c: Company) => perActive(c).toFixed(1),
  },
];

/** The table as an Excel sheet, with the same Russian headers the screen shows. */
function companyRows(rows: Company[]) {
  return rows.map((c) => ({
    "Имя группы": c.groupName,
    "Активные пользователи": c.activeUsers,
    "Всего пользователей": c.totalUsers,
    "Закрытых заявок": c.closedRequests,
    "Отклоненных заявок": c.rejectedRequests,
    "Открытых на конец периода": c.openRequests,
    "Всего сообщений": c.totalMessages,
    "Заявок на активного": +perActive(c).toFixed(1),
  }));
}

export default function CompaniesPage() {
  const [[start, end], setRange] = useState(defaultRange);
  const [search, setSearch] = useState("");

  const startStr = toApiDate(start);
  const endStr = toApiDate(end);
  const { canExport } = useAuth();
  const { data = [], isFetching, error } = useCompanies(startStr, endStr);

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.trim().toLowerCase();
    return data.filter((row) =>
      Object.values(row).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [data, search]);

  return (
    <Card>
      <div className="table-toolbar">
        <Space wrap size={12}>
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
        </Space>
        <Space wrap size={12}>
          <span className="meta">{filtered.length} групп</span>
          {canExport && (
            <>
              <Tooltip title="Экспорт таблицы">
                <Button
                  icon={<FileExcelOutlined />}
                  onClick={() =>
                    void exportToExcel(companyRows(filtered), `groups_${startStr}_${endStr}.xlsx`, "Группы")
                  }
                  disabled={filtered.length === 0}
                >
                  Excel
                </Button>
              </Tooltip>
            </>
          )}
        </Space>
      </div>
      <QueryError error={error} />
      <Table
        rowKey="groupName"
        columns={columns}
        dataSource={filtered}
        loading={isFetching}
        pagination={false}
        size="middle"
        scroll={{ x: true }}
        sticky={{ offsetHeader: 60 }}
      />
    </Card>
  );
}
