import { FileExcelOutlined, UserOutlined } from "@ant-design/icons";
import { App, Avatar, Button, Card, DatePicker, Empty, Input, List, Select, Space, Spin, Tooltip } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useChatParticipants, useChats, useGroups } from "../api/queries";
import type { ChatMessage } from "../api/types";
import QueryError from "../components/QueryError";
import { defaultRange, toApiDate } from "../lib/date";
import { exportToExcel } from "../lib/excel";

const { RangePicker } = DatePicker;

/** Excel rows with Russian headers, like every other export. */
function exportRows(rows: ChatMessage[]) {
  return rows.map((m) => ({
    Дата: dayjs(m.createdAt).format("DD.MM.YYYY HH:mm:ss"),
    Клиент: m.client,
    Направление: m.direction === "out" ? "ответ поддержки" : "сообщение клиента",
    Отправитель: m.sender,
    Получатель: m.recipient,
    Сообщение: m.message,
  }));
}

export default function ChatPage() {
  const { message } = App.useApp();
  // Deep links from other screens (e.g. the open-ticket list) preselect the
  // conversation: /chat?group=X&user=Y&start=…&end=…
  const [params] = useSearchParams();
  const [[start, end], setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>(() => {
    const from = params.get("start");
    const to = params.get("end");
    return from && to ? [dayjs(from), dayjs(to)] : defaultRange();
  });
  const [group, setGroup] = useState<string | null>(params.get("group"));
  const [selectedUser, setSelectedUser] = useState<string | null>(params.get("user"));
  const [userSearch, setUserSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [exportingAll, setExportingAll] = useState(false);

  const startStr = toApiDate(start);
  const endStr = toApiDate(end);

  const { data: groups = [], error: groupsError } = useGroups("chats");
  // The conversation list comes from the chat endpoint (CHATS grant), not
  // from the per-user statistics: a desk granted chats alone must see it.
  const {
    data: users = [],
    isFetching: usersLoading,
    error: usersError,
  } = useChatParticipants(startStr, endStr, group);
  // Only the selected conversation is loaded — a group's whole year of text
  // is fetched solely for the "all chats" export, on demand.
  const {
    data: chats = [],
    isFetching: chatLoading,
    error: chatError,
  } = useChats(startStr, endStr, group, selectedUser);

  // A period or group change can make the selected client disappear from the
  // list; keep the selection only while it is still there.
  useEffect(() => {
    if (selectedUser && !usersLoading && !usersError && !users.includes(selectedUser)) {
      setSelectedUser(null);
    }
  }, [users, usersLoading, usersError, selectedUser]);

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return users;
    const q = userSearch.trim().toLowerCase();
    return users.filter((u) => u.toLowerCase().includes(q));
  }, [users, userSearch]);

  const userMessages = useMemo(() => {
    if (!messageSearch.trim()) return chats;
    const q = messageSearch.trim().toLowerCase();
    return chats.filter((c) => c.message.toLowerCase().includes(q));
  }, [chats, messageSearch]);

  // Messages of different years are told apart only by the date, and a range
  // can span years, so the year stays in.
  const spansYears = start.year() !== end.year();
  const timeFormat = spansYears ? "DD.MM.YYYY HH:mm" : "DD MMM HH:mm";

  const exportAll = async () => {
    if (!group) return;
    setExportingAll(true);
    try {
      const all = await api.getChats(startStr, endStr, group);
      if (all.length === 0) {
        message.info("За выбранный период переписки нет");
        return;
      }
      await exportToExcel(exportRows(all), `AllChats_${group}_${startStr}_${endStr}.xlsx`, "Чаты");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Не удалось выгрузить переписку");
    } finally {
      setExportingAll(false);
    }
  };

  return (
    <Card styles={{ body: { padding: 0 } }}>
      <div className="chat-toolbar">
        <Space wrap>
          <RangePicker
            value={[start, end]}
            onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
            allowClear={false}
          />
          <Select
            showSearch
            placeholder="Выберите группу"
            style={{ width: 220 }}
            value={group}
            onChange={(g) => {
              setGroup(g);
              setSelectedUser(null);
            }}
            options={groups.map((g) => ({ value: g.groupName, label: g.groupName }))}
          />
        </Space>
        <Tooltip title="Экспорт всех чатов группы за период">
          <Button
            icon={<FileExcelOutlined />}
            onClick={() => void exportAll()}
            loading={exportingAll}
            disabled={!group}
          >
            Все чаты
          </Button>
        </Tooltip>
      </div>

      {(groupsError || usersError) && (
        <div style={{ padding: "16px 16px 0" }}>
          <QueryError error={groupsError ?? usersError} style={{ marginBottom: 0 }} />
        </div>
      )}

      <div className="chat-body">
        <div className="chat-userlist">
          <Input.Search
            placeholder="Поиск пользователя"
            allowClear
            onChange={(e) => setUserSearch(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          {!group ? (
            <Empty description="Выберите группу" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <List
              loading={usersLoading}
              dataSource={filteredUsers}
              locale={{ emptyText: "За период переписки нет" }}
              renderItem={(u) => (
                <List.Item
                  className={`chat-user ${u === selectedUser ? "active" : ""}`}
                  onClick={() => setSelectedUser(u)}
                >
                  <List.Item.Meta avatar={<Avatar icon={<UserOutlined />} />} title={u} />
                </List.Item>
              )}
            />
          )}
        </div>

        <div className="chat-conversation">
          {!selectedUser ? (
            <div className="chat-center">
              <Empty description="Выберите пользователя" />
            </div>
          ) : (
            <>
              <div className="chat-conversation-header">
                <Space>
                  <Avatar icon={<UserOutlined />} />
                  <strong>{selectedUser}</strong>
                </Space>
                <Space>
                  <Input.Search
                    placeholder="Поиск по содержанию"
                    allowClear
                    style={{ width: 220 }}
                    onChange={(e) => setMessageSearch(e.target.value)}
                  />
                  <Tooltip title="Экспорт выбранного чата">
                    <Button
                      icon={<FileExcelOutlined />}
                      onClick={() =>
                        void exportToExcel(
                          exportRows(userMessages),
                          `Chat_${selectedUser}_${startStr}_${endStr}.xlsx`,
                          "Чат",
                        )
                      }
                      disabled={userMessages.length === 0}
                    />
                  </Tooltip>
                </Space>
              </div>
              <div className="chat-messages">
                {chatError && <QueryError error={chatError} />}
                {chatLoading ? (
                  <div className="chat-center">
                    <Spin />
                  </div>
                ) : (
                  <>
                    {userMessages.map((m, i) => (
                      <div key={i} className={`msg-row ${m.direction === "out" ? "sent" : "received"}`}>
                        <div className="bubble">{m.message}</div>
                        <div className="msg-time">
                          {m.direction === "out" ? `${m.sender} · ` : ""}
                          {dayjs(m.createdAt).format(timeFormat)}
                        </div>
                      </div>
                    ))}
                    {userMessages.length === 0 && !chatError && (
                      <Empty description="Нет сообщений" style={{ marginTop: 40 }} />
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
