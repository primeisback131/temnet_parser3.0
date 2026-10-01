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
import { useChatParticipants, useChatTickets, useChats, useGroups } from "../api/queries";
import type { ChatMessage, ChatTicket } from "../api/types";
import DrillNavigator, { useDrillNav } from "../components/DrillNavigator";
import QueryError from "../components/QueryError";
import { chartColors } from "../lib/chartTheme";
import { exportGroupChats, exportRows } from "../lib/chatExport";
import { defaultRange, toApiDate } from "../lib/date";
import { asDrillKey, BURST_GAP_MINUTES } from "../lib/drillEvents";
import { exportToExcel } from "../lib/excel";
import { humanizeSeconds } from "../lib/format";
import { useThemeMode } from "../theme";

const { RangePicker } = DatePicker;

/** Messages of one side this close together read as one run: the time is shown once. */
const RUN_GAP_MINUTES = 5;

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
  // Opened from a metric card's drawer: the card, its scope, and the moment of
  // the event the chat stands on (the event bar steps through the rest).
  const [metric, setMetric] = useState(() => asDrillKey(params.get("metric")));
  const [drillGroup, setDrillGroup] = useState<string | null>(params.get("drillGroup"));
  const [eventAt, setEventAt] = useState<string | null>(params.get("at"));
  // The card's period as the drawer had it: the events come from it, while
  // the chat's own period widens to show an event outside it (a ticket closed
  // or gone silent after the period, an open ticket older than it).
  const [drillPeriod] = useState(() => ({
    start: params.get("drillStart") ?? params.get("start") ?? toApiDate(defaultRange()[0]),
    end: params.get("drillEnd") ?? params.get("end") ?? toApiDate(defaultRange()[1]),
  }));
  // The user picked the period by hand: steps stay inside it, nothing widens.
  const [ownPeriod, setOwnPeriod] = useState(false);
  const [wantClients, setWantClients] = useState(false);
  const pendingStep = useRef<-1 | 1 | null>(null);
  // A client the bar moved to may be missing from the list until its group
  // and period reload; the "not in the list" check waits for it.
  const switching = useRef(Boolean(params.get("metric") && params.get("user")));
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
    if (metric) {
      next.set("metric", metric);
      next.set("drillStart", drillPeriod.start);
      next.set("drillEnd", drillPeriod.end);
      if (drillGroup) next.set("drillGroup", drillGroup);
      if (eventAt) next.set("at", eventAt);
    }
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [startStr, endStr, group, selectedUser, metric, drillGroup, drillPeriod, eventAt, params, setParams]);

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
    if (!selectedUser || usersLoading || usersError) return;
    const present = participants.some((p) => p.client === selectedUser);
    if (switching.current) {
      if (present) switching.current = false;
      return;
    }
    if (!present) setSelectedUser(null);
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

  const nav = useDrillNav({
    metric,
    start: drillPeriod.start,
    end: drillPeriod.end,
    drillGroup,
    client: selectedUser,
    chats,
    wantClients,
  });
  // With a period picked by hand the steps stay inside it.
  const events = useMemo(
    () => (ownPeriod ? nav.events.filter((at) => at.slice(0, 10) >= startStr && at.slice(0, 10) <= endStr) : nav.events),
    [nav.events, ownPeriod, startStr, endStr],
  );
  // An event is a message time. The feed may lack it (a chat granted for one
  // desk): a message within BURST_GAP_MINUTES after it stands in, no further.
  const messageAt = (at: string) => {
    const i = chats.findIndex((m) => m.createdAt >= at);
    return i >= 0 && dayjs(chats[i].createdAt).diff(at, "minute") <= BURST_GAP_MINUTES ? i : -1;
  };
  const eventIndexes = useMemo(
    () => new Set(events.map(messageAt).filter((i) => i >= 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, chats],
  );
  const eventIndex = eventAt ? events.indexOf(eventAt) : -1;
  const targetIndex = metric && eventAt && !chatLoading ? messageAt(eventAt) : -1;
  const hidden = metric != null && eventAt != null && !chatLoading && !nav.loading && targetIndex < 0;
  // Neighbours by time, so a row that is not an event steps forward and back too.
  const prevEvent = eventAt == null ? -1 : events.reduce((last, at, i) => (at < eventAt ? i : last), -1);
  const nextEvent = eventAt == null ? (events.length ? 0 : -1) : events.findIndex((at) => at > eventAt);
  // No moment in the link (a client row, the next client, a new period): the first event.
  useEffect(() => {
    if (metric && eventAt == null && events.length > 0) setEventAt(events[0]);
  }, [metric, eventAt, events]);
  // Show the event even outside the period: widen once per event, never after
  // the user picked the period by hand.
  useEffect(() => {
    if (!metric || !eventAt || ownPeriod) return;
    const day = dayjs(eventAt.slice(0, 10));
    if (day.isBefore(start, "day") || day.isAfter(end, "day")) {
      setRange([day.isBefore(start, "day") ? day : start, day.isAfter(end, "day") ? day : end]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventAt]);

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
  useEffect(() => {
    if (!needle && targetIndex >= 0) scrollToMessage(targetIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetIndex, needle]);

  // Where to land after the conversation loads: the top for a deep link (the
  // ticket that was clicked is there), the newest message otherwise.
  useEffect(() => {
    if (chatLoading || chats.length === 0) return;
    if (needle || targetIndex >= 0) return;
    const feed = feedRef.current;
    if (!feed) return;
    feed.scrollTop = deepLinked.current ? 0 : feed.scrollHeight;
    deepLinked.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats, chatLoading, selectedUser]);

  const pickUser = (client: string) => {
    deepLinked.current = false;
    setSelectedUser(client);
    setEventAt(null);
  };

  const clientIndex = nav.clients?.findIndex((c) => c.client === selectedUser) ?? -1;
  const goEvent = (i: number) => {
    // An explicit step wins over the in-dialog search.
    setMessageSearch("");
    setEventAt(events[i] ?? null);
  };
  const goClient = (step: -1 | 1) => {
    if (nav.clients == null) {
      // The whole list loads on the first step; the step runs when it arrives.
      pendingStep.current = step;
      setWantClients(true);
      return;
    }
    const next = nav.clients[clientIndex < 0 ? (step > 0 ? 0 : -1) : clientIndex + step];
    if (!next) return;
    switching.current = true;
    setMessageSearch("");
    setOwnPeriod(false);
    setRange([dayjs(drillPeriod.start), dayjs(drillPeriod.end)]);
    if (next.group !== group) setGroup(next.group);
    setSelectedUser(next.client);
    setEventAt(null);
  };
  useEffect(() => {
    if (nav.clients != null && pendingStep.current != null) {
      const step = pendingStep.current;
      pendingStep.current = null;
      goClient(step);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.clients]);
  const closeNav = () => {
    setMetric(null);
    setDrillGroup(null);
    setEventAt(null);
  };

  const exportAll = async () => {
    if (!group) return;
    setExportingAll(true);
    try {
      await exportGroupChats(message, start, end, group);
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
            onChange={(v) => {
              if (!v || !v[0] || !v[1]) return;
              setRange([v[0], v[1]]);
              if (metric) {
                // A period of one's own: the bar steps inside it from its first event.
                setOwnPeriod(true);
                setEventAt(null);
              }
            }}
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
              {metric && (
                <DrillNavigator
                  metric={metric}
                  accent={colors.amber}
                  index={eventIndex}
                  total={events.length}
                  prev={prevEvent}
                  next={nextEvent}
                  loading={nav.loading || chatLoading}
                  failed={nav.error != null}
                  hidden={hidden}
                  clientIndex={clientIndex}
                  clientCount={nav.clients?.length ?? null}
                  onEvent={goEvent}
                  onClient={goClient}
                  onClose={closeNav}
                />
              )}
              <div className="chat-messages" ref={feedRef}>
                {chatError && <QueryError error={chatError} />}
                {nav.error != null && <QueryError error={nav.error} />}
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
                      const isCurrent = needle ? index === currentMatch : index === targetIndex;
                      return (
                        <div
                          key={item.key}
                          data-index={index}
                          className={`msg-row ${m.direction === "out" ? "sent" : "received"}${item.cont ? " cont" : ""}${isCurrent ? " current" : ""}${eventIndexes.has(index) ? " event" : ""}`}
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
