import { FileExcelOutlined } from "@ant-design/icons";
import { Button, Card, DatePicker, Empty, Input, Select, Space, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useGroups, useUsers } from "../api/queries";
import type { UserStat } from "../api/types";
import { useAuth } from "../auth";
import { defaultRange, toApiDate } from "../lib/date";
import { exportToExcel } from "../lib/excel";

const { RangePicker } = DatePicker;

const columns: ColumnsType<UserStat> = [
  { title: "Имя пользователя", dataIndex: "userName", sorter: (a, b) => a.userName.localeCompare(b.userName) },
  { title: "Закрытых заявок", dataIndex: "closedRequests", sorter: (a, b) => a.closedRequests - b.closedRequests },
  { title: "Отклоненных заявок", dataIndex: "rejectedRequests", sorter: (a, b) => a.rejectedRequests - b.rejectedRequests },
  { title: "Открытых на конец периода", dataIndex: "openRequests", sorter: (a, b) => a.openRequests - b.openRequests },
  { title: "Всего сообщений", dataIndex: "totalMessages", sorter: (a, b) => a.totalMessages - b.totalMessages },
];

export default function UsersPage() {
  const [[start, end], setRange] = useState(defaultRange);
  const [group, setGroup] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const startStr = toApiDate(start);
  const endStr = toApiDate(end);

  const { canExport } = useAuth();
  const { data: groups = [] } = useGroups();
  const { data = [], isFetching } = useUsers(startStr, endStr, group);

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
            placeholder="Поиск пользователя"
            allowClear
            style={{ width: 220 }}
            onChange={(e) => setSearch(e.target.value)}
          />
          <RangePicker
            value={[start, end]}
            onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
            allowClear={false}
          />
          <Select
            showSearch
            placeholder="Группа"
            style={{ width: 220 }}
            value={group}
            onChange={setGroup}
            options={groups.map((g) => ({ value: g.groupName, label: g.groupName }))}
          />
        </Space>
        <Space size={12}>
          {group && <span className="meta">{filtered.length} записей</span>}
          {canExport && (
            <Tooltip title="Экспорт таблицы">
              <Button
                icon={<FileExcelOutlined />}
                onClick={() =>
                  exportToExcel(filtered, `${group ?? "users"}_${startStr}_${endStr}.xlsx`, "Пользователи")
                }
                disabled={filtered.length === 0}
              >
                Excel
              </Button>
            </Tooltip>
          )}
        </Space>
      </div>
      {group ? (
        <Table
          rowKey="userName"
          columns={columns}
          dataSource={filtered}
          loading={isFetching}
          pagination={false}
          size="middle"
          scroll={{ x: true }}
          sticky={{ offsetHeader: 60 }}
        />
      ) : (
        <Empty description="Выберите группу" style={{ padding: "40px 0" }} />
      )}
    </Card>
  );
}
