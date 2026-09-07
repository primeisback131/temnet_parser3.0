import {
  ArrowLeftOutlined,
  DownOutlined,
  FileExcelOutlined,
  SearchOutlined,
  UpOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  App,
  Avatar,
  Badge,
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  List,
  Select,
  Space,
  Spin,
  Tooltip,
} from "antd";
import dayjs from "dayjs";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useChatParticipants, useChatTickets, useChats, useGroups } from "../api/queries";
import type { ChatMessage, ChatTicket } from "../api/types";
import QueryError from "../components/QueryError";
import { chartColors } from "../lib/chartTheme";
import { defaultRange, toApiDate } from "../lib/date";
import { exportToExcel } from "../lib/excel";
import { humanizeSeconds } from "../lib/format";
import { useThemeMode } from "../theme";

const { RangePicker } = DatePicker;

/** Messages of one side this close together read as one run: the time is shown once. */
const RUN_GAP_MINUTES = 5;

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

/** The text with every case-insensitive occurrence of `q` wrapped in <mark>. */
function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(needle, from); at >= 0; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at}>{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return parts;
}

/** A moment shown relative to the period: time today-style within a year, date otherwise. */
function shortWhen(iso: string, spansYears: boolean) {
  return dayjs(iso).format(spansYears ? "DD.MM.YY HH:mm" : "DD MMM HH:mm");
}

type Item =
  | { kind: "day"; key: string; label: string }
  | { kind: "ticket"; key: string; label: string; accent: string }
  | { kind: "msg"; key: string; index: number; m: ChatMessage; cont: boolean; showTime: boolean };

/**
 * Messages, day separators and ticket markers in one chronological list. A
 * ticket's opening marker goes before the message that opened it (same
 * timestamp), its closing marker after the message that closed it.
 */
function buildTimeline(
  chats: ChatMessage[],
  tickets: ChatTicket[],
  colors: ReturnType<typeof chartColors>,
  spansYears: boolean,
): Item[] {
  type Event = { at: string; order: number; item: Item };
  const events: Event[] = chats.map((m, index) => ({
    at: m.createdAt,
    order: 1,
    item: { kind: "msg", key: `m${index}`, index, m, cont: false, showTime: true },
  }));
  tickets.forEach((t, i) => {
    events.push({
      at: t.openedAt,
      order: 0,
      item: {
        kind: "ticket",
        key: `o${i}`,
        label: `Заявка · ${t.category}${t.reopen ? " · повтор" : ""}`,
        accent: t.reopen ? colors.amber : colors.blue,
      },
    });
    if (t.inProgressAt) {
      events.push({
        at: t.inProgressAt,
        order: 2,
        item: { kind: "ticket", key: `p${i}`, label: "В работе", accent: colors.violet },
      });
    }
    if (t.closedAt) {
      const took = t.resolutionSeconds != null ? ` за ${humanizeSeconds(t.resolutionSeconds)}` : "";
      const who = t.closedBy ? ` · ${t.closedBy}` : "";
      events.push({
        at: t.closedAt,
        order: 2,
        item: {
          kind: "ticket",
          key: `c${i}`,
          label:
            t.status === "rejected"
              ? `Отклонена${who}`
              : `Закрыта${took}${who}${t.thanked ? " · спасибо" : ""}`,
          accent: t.status === "rejected" ? colors.rose : colors.green,
        },
      });
    } else if (t.status === "expired") {
      events.push({
        at: t.lastActivity,
        order: 2,
        item: { kind: "ticket", key: `e${i}`, label: "Истекла по тишине", accent: colors.faint },
      });
    }
  });
  events.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);

  const items: Item[] = [];
  let day = "";
  let prevMsg: Extract<Item, { kind: "msg" }> | null = null;
  for (const e of events) {
    const d = e.at.slice(0, 10);
    if (d !== day) {
      day = d;
      items.push({ kind: "day", key: `d${d}`, label: dayjs(d).format(spansYears ? "D MMMM YYYY" : "D MMMM, dddd") });
      prevMsg = null;
    }
    if (e.item.kind === "msg") {
      const m = e.item.m;
      if (
        prevMsg &&
        prevMsg.m.direction === m.direction &&
        prevMsg.m.sender === m.sender &&
        dayjs(m.createdAt).diff(prevMsg.m.createdAt, "minute") < RUN_GAP_MINUTES
      ) {
        e.item.cont = true;
        prevMsg.showTime = false;
      }
      prevMsg = e.item;
    } else {
      prevMsg = null;
    }
    items.push(e.item);
  }
  return items;
}

export default function ChatPage() {
  const { message } = App.useApp();
  const { mode } = useThemeMode();
  const colors = chartColors(mode);
  // The selection lives in the URL, so a refresh keeps it and the link can be
  // handed to a colleague; other screens deep-link here the same way
  // (/chat?group=X&user=Y&start=…&end=…).
  const [params, setParams] = useSearchParams();
  const [[start, end], setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>(() => {
    const from = params.get("start");
    const to = params.get("end");
    return from && to ? [dayjs(from), dayjs(to)] : defaultRange();
  });
  const [group, setGroup] = useState<string | null>(params.get("group"));
  const [selectedUser, setSelectedUser] = useState<string | null>(params.get("user"));
  // Arriving by deep link, the interesting part is where the period starts
  // (the ticket that was clicked); otherwise the newest messages matter.
  const deepLinked = useRef(Boolean(params.get("user")));
  const [userSearch, setUserSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [exportingAll, setExportingAll] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  const startStr = toApiDate(start);
  const endStr = toApiDate(end);

  useEffect(() => {
    const next = new URLSearchParams();
    next.set("start", startStr);
    next.set("end", endStr);
    if (group) next.set("group", group);
    if (selectedUser) next.set("user", selectedUser);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [startStr, endStr, group, selectedUser, params, setParams]);

  const { data: groups = [], error: groupsError } = useGroups("chats");
  const {
    data: participants = [],
    isFetching: usersLoading,
    error: usersError,
  } = useChatParticipants(startStr, endStr, group);
  // Only the selected conversation is loaded — a group's whole year of text
  // is fetched solely for the "all chats" export, on demand.
  const { data: chats = [], isFetching: chatLoading, error: chatError } = useChats(
    startStr,
    endStr,
    group,
    selectedUser,
  );
  const { data: tickets = [] } = useChatTickets(startStr, endStr, group, selectedUser);

  // A period or group change can make the selected client disappear from the
  // list; keep the selection only while it is still there.
  useEffect(() => {
    if (selectedUser && !usersLoading && !usersError && !participants.some((p) => p.client === selectedUser)) {
      setSelectedUser(null);
    }
  }, [participants, usersLoading, usersError, selectedUser]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return participants;
    return participants.filter(
      (p) => p.client.toLowerCase().includes(q) || p.lastText.toLowerCase().includes(q),
    );
  }, [participants, userSearch]);

  // Messages of different years are told apart only by the date, and a range
  // can span years, so the year stays in.
  const spansYears = start.year() !== end.year();

  const timeline = useMemo(
    () => buildTimeline(chats, tickets, colors, spansYears),
    [chats, tickets, colors, spansYears],
  );

  // Matches of the in-conversation search, as message indexes; the feed keeps
  // every message and highlights these.
  const needle = messageSearch.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? chats.flatMap((m, i) => (m.message.toLowerCase().includes(needle) ? [i] : [])) : []),
    [chats, needle],
  );
  useEffect(() => setMatchIndex(0), [needle, chats]);

  const scrollToMessage = (index: number) => {
    const el = feedRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    el?.scrollIntoView({ block: "center" });
  };
  useEffect(() => {
    if (matches.length > 0) scrollToMessage(matches[matchIndex] ?? matches[0]);
  }, [matches, matchIndex]);

  // Where to land after the conversation loads: the top for a deep link (the
  // ticket that was clicked is there), the newest message otherwise.
  useEffect(() => {
    if (chatLoading || chats.length === 0) return;
    if (needle) return;
    const feed = feedRef.current;
    if (!feed) return;
    feed.scrollTop = deepLinked.current ? 0 : feed.scrollHeight;
    deepLinked.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats, chatLoading, selectedUser]);

  const pickUser = (client: string) => {
    deepLinked.current = false;
    setSelectedUser(client);
  };

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

  const currentMatch = matches[matchIndex];

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

      <div className={`chat-body${selectedUser ? " has-selection" : ""}`}>
        <div className="chat-userlist">
          {!group ? (
            <Empty description="Выберите группу" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <>
              <Input.Search
                placeholder="Поиск по логину или последней фразе"
                allowClear
                onChange={(e) => setUserSearch(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              <List
                loading={usersLoading}
                dataSource={filteredUsers}
                locale={{ emptyText: "За период переписки нет" }}
                renderItem={(p) => (
                  <List.Item
                    className={`chat-user ${p.client === selectedUser ? "active" : ""}`}
                    onClick={() => pickUser(p.client)}
                    extra={
                      <div className="chat-user-side">
                        <span>{shortWhen(p.lastAt, spansYears)}</span>
                        <Badge count={p.messages} overflowCount={999} color={colors.faint} size="small" />
                      </div>
                    }
                  >
                    <List.Item.Meta
                      avatar={<Avatar icon={<UserOutlined />} />}
                      title={p.client}
                      description={
                        <span className="chat-user-preview">
                          {p.lastDirection === "out" ? "↩ " : ""}
                          {p.lastText}
                        </span>
                      }
                    />
                  </List.Item>
                )}
              />
            </>
          )}
        </div>

        <div className="chat-conversation">
          {!selectedUser ? (
            <div className="chat-center">
              <Empty description="Выберите диалог" />
            </div>
          ) : (
            <>
              <div className="chat-conversation-header">
                <Space>
                  <Button
                    className="chat-back"
                    type="text"
                    icon={<ArrowLeftOutlined />}
                    onClick={() => setSelectedUser(null)}
                  />
                  <Avatar icon={<UserOutlined />} />
                  <strong>{selectedUser}</strong>
                  <span className="meta">{chats.length} сообщений</span>
                </Space>
                <Space>
                  <Input
                    prefix={<SearchOutlined />}
                    placeholder="Поиск в диалоге"
                    allowClear
                    value={messageSearch}
                    style={{ width: 220 }}
                    onChange={(e) => setMessageSearch(e.target.value)}
                    onPressEnter={() => matches.length && setMatchIndex((i) => (i + 1) % matches.length)}
                    suffix={needle ? <span className="meta">{matches.length ? `${matchIndex + 1} из ${matches.length}` : "0"}</span> : null}
                  />
                  <Button
                    icon={<UpOutlined />}
                    disabled={matches.length === 0}
                    onClick={() => setMatchIndex((i) => (i - 1 + matches.length) % matches.length)}
                  />
                  <Button
                    icon={<DownOutlined />}
                    disabled={matches.length === 0}
                    onClick={() => setMatchIndex((i) => (i + 1) % matches.length)}
                  />
                  <Tooltip title="Экспорт выбранного чата">
                    <Button
                      icon={<FileExcelOutlined />}
                      onClick={() =>
                        void exportToExcel(exportRows(chats), `Chat_${selectedUser}_${startStr}_${endStr}.xlsx`, "Чат")
                      }
                      disabled={chats.length === 0}
                    />
                  </Tooltip>
                </Space>
              </div>
              <div className="chat-messages" ref={feedRef}>
                {chatError && <QueryError error={chatError} />}
                {chatLoading ? (
                  <div className="chat-center">
                    <Spin />
                  </div>
                ) : (
                  <>
                    {timeline.map((item) => {
                      if (item.kind === "day") {
                        return (
                          <div key={item.key} className="chat-sep">
                            {item.label}
                          </div>
                        );
                      }
                      if (item.kind === "ticket") {
                        return (
                          <div key={item.key} className="chat-sep">
                            <span className="ticket-mark" style={{ "--mark-accent": item.accent } as CSSProperties}>
                              {item.label}
                            </span>
                          </div>
                        );
                      }
                      const { m, index } = item;
                      const isCurrent = index === currentMatch;
                      return (
                        <div
                          key={item.key}
                          data-index={index}
                          className={`msg-row ${m.direction === "out" ? "sent" : "received"}${item.cont ? " cont" : ""}${isCurrent ? " current" : ""}`}
                        >
                          <div className="bubble">{highlight(m.message, needle ? messageSearch.trim() : "")}</div>
                          {item.showTime && (
                            <div className="msg-time">
                              {m.direction === "out" ? `${m.sender} · ` : ""}
                              {dayjs(m.createdAt).format("HH:mm")}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {chats.length === 0 && !chatError && <Empty description="Нет сообщений" style={{ marginTop: 40 }} />}
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
