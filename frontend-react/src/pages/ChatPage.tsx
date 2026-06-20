import { FileExcelOutlined, UserOutlined } from "@ant-design/icons";
import { Avatar, Button, Card, DatePicker, Empty, Input, List, Select, Space, Spin, Tooltip } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useChats, useGroups, useUsers } from "../api/queries";
import type { ChatMessage } from "../api/types";
import { defaultRange, toApiDate } from "../lib/date";
import { exportToExcel } from "../lib/excel";

const { RangePicker } = DatePicker;

export default function ChatPage() {
  const [[start, end], setRange] = useState(defaultRange);
  const [group, setGroup] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");

  const startStr = toApiDate(start);
  const endStr = toApiDate(end);

  const { data: groups = [] } = useGroups();
  const { data: users = [] } = useUsers(startStr, endStr, group);
  const { data: chats = [], isFetching } = useChats(startStr, endStr, group);

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return users;
    const q = userSearch.trim().toLowerCase();
    return users.filter((u) => u.userName.toLowerCase().includes(q));
  }, [users, userSearch]);

  const userMessages = useMemo(() => {
    if (!selectedUser) return [];
    let msgs = chats.filter(
      (c) => c.sender === selectedUser || c.recipient === selectedUser,
    );
    if (messageSearch.trim()) {
      const q = messageSearch.trim().toLowerCase();
      msgs = msgs.filter((c) => c.message.toLowerCase().includes(q));
    }
    return msgs;
  }, [chats, selectedUser, messageSearch]);

  const exportChat = (rows: ChatMessage[], name: string) => {
    if (rows.length > 0) exportToExcel(rows, name);
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
        <Tooltip title="Экспорт всех чатов группы">
          <Button
            icon={<FileExcelOutlined />}
            onClick={() => exportChat(chats, `AllChats_${group}_${startStr}_${endStr}.xlsx`)}
            disabled={chats.length === 0}
          >
            Все чаты
          </Button>
        </Tooltip>
      </div>

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
              dataSource={filteredUsers}
              renderItem={(u) => (
                <List.Item
                  className={`chat-user ${u.userName === selectedUser ? "active" : ""}`}
                  onClick={() => setSelectedUser(u.userName)}
                >
                  <List.Item.Meta
                    avatar={<Avatar icon={<UserOutlined />} />}
                    title={u.userName}
                  />
                </List.Item>
              )}
            />
          )}
        </div>

        <div className="chat-conversation">
          {isFetching ? (
            <div className="chat-center">
              <Spin />
            </div>
          ) : !selectedUser ? (
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
                      onClick={() => exportChat(userMessages, `Chat_${selectedUser}.xlsx`)}
                      disabled={userMessages.length === 0}
                    />
                  </Tooltip>
                </Space>
              </div>
              <div className="chat-messages">
                {userMessages.map((m, i) => {
                  const fromSupport = m.sender.includes("help");
                  return (
                    <div key={i} className={`msg-row ${fromSupport ? "sent" : "received"}`}>
                      <div className="bubble">{m.message}</div>
                      <div className="msg-time">
                        {dayjs(m.createdAt).format("DD MMM HH:mm")}
                      </div>
                    </div>
                  );
                })}
                {userMessages.length === 0 && (
                  <Empty description="Нет сообщений" style={{ marginTop: 40 }} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
