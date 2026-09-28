import { CloseOutlined, DownOutlined, LeftOutlined, RightOutlined, UpOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import type { CSSProperties } from "react";
import { useMemo } from "react";
import { useBacklogTickets, useClientMessages, useOffHoursMessages, useTicketDetails } from "../api/queries";
import type { ChatMessage } from "../api/types";
import { useAuth } from "../auth";
import { chatGroupFor } from "../lib/chatAccess";
import type { DrillKey } from "../lib/drillEvents";
import { bursts, conversationDays, EVENT_TITLES, TICKET_EVENTS } from "../lib/drillEvents";
import { compareAccountNames } from "../lib/format";

export interface NavClient {
  client: string;
  /** The group whose chat shows the client. */
  group: string;
}

export interface DrillNav {
  loading: boolean;
  error: unknown;
  /** The client's event moments, oldest first. */
  events: string[];
  /**
   * Clients with events, the most first, only those whose chats the account
   * may read; null until asked for (a ticket card's whole list is big, so it
   * loads on the first step to another client).
   */
  clients: NavClient[] | null;
}

interface Source {
  metric: DrillKey | null;
  /** The card's period and scope, as the drawer had them. */
  start: string;
  end: string;
  drillGroup: string | null;
  client: string | null;
  /** The conversation on screen: the volume card's events are its days. */
  chats: ChatMessage[];
  wantClients: boolean;
}

/**
 * The events of a metric card for the chat, from the lists its drawer shows:
 * ticket rows through TICKET_EVENTS (one client's rows for the events, the
 * whole list only for the client order), off-hours messages merged into
 * sittings, open tickets by opening, and conversation days for the volume
 * card.
 */
export function useDrillNav({ metric, start, end, drillGroup, client, chats, wantClients }: Source): DrillNav {
  const { user } = useAuth();
  const spec = metric ? TICKET_EVENTS[metric] : undefined;
  const cohort = spec?.cohort ?? "opened";
  const own = useTicketDetails(start, end, cohort, drillGroup, spec != null && client != null, client);
  const all = useTicketDetails(start, end, cohort, drillGroup, spec != null && wantClients);
  const open = useBacklogTickets(end, drillGroup, metric === "open");
  const offHours = useOffHoursMessages(start, end, drillGroup, metric === "offHours");
  const volume = useClientMessages(start, end, drillGroup, metric === "messages" && wantClients);

  // client -> its group names and event moments, for the sources that list every client.
  const byClient = useMemo(() => {
    const map = new Map<string, { groupNames: string | null; times: string[] }>();
    const add = (c: string, groupNames: string | null, at: string) => {
      const entry = map.get(c) ?? { groupNames, times: [] };
      entry.times.push(at);
      map.set(c, entry);
    };
    if (spec) {
      for (const t of all.data?.tickets ?? []) if (spec.test(t)) add(t.client, t.groupNames, spec.at(t));
    } else if (metric === "open") {
      for (const t of open.data ?? []) add(t.client, t.groupNames, t.openedAt);
    } else if (metric === "offHours") {
      for (const m of offHours.data ?? []) add(m.client, m.groupNames, m.at);
    }
    for (const entry of map.values()) {
      entry.times.sort();
      if (metric === "offHours") entry.times = bursts(entry.times);
    }
    return map;
  }, [metric, spec, all.data, open.data, offHours.data]);

  const events = useMemo(() => {
    if (client == null) return [];
    if (metric === "messages") return conversationDays(chats);
    if (spec) {
      return (own.data?.tickets ?? [])
        .filter((t) => t.client === client && spec.test(t))
        .map(spec.at)
        .sort();
    }
    return byClient.get(client)?.times ?? [];
  }, [metric, spec, client, chats, own.data, byClient]);

  const listed = spec ? all.data != null : metric === "messages" ? volume.data != null : true;
  const clients = useMemo<NavClient[] | null>(() => {
    if (!listed) return null;
    const ranked: Array<{ client: string; groupNames: string | null; weight: number }> =
      metric === "messages"
        ? (volume.data ?? []).map((r) => ({ client: r.client, groupNames: r.groupNames, weight: r.messagesIn + r.messagesOut }))
        : [...byClient].map(([c, e]) => ({ client: c, groupNames: e.groupNames, weight: e.times.length }));
    return ranked
      .sort((a, b) => b.weight - a.weight || compareAccountNames(a.client, b.client))
      .flatMap((r) => {
        const group = chatGroupFor(user, r.groupNames, drillGroup);
        return group ? [{ client: r.client, group }] : [];
      });
  }, [listed, metric, byClient, volume.data, user, drillGroup]);

  const queries = spec ? [own, all] : metric === "open" ? [open] : metric === "offHours" ? [offHours] : [volume];
  return {
    loading: metric != null && queries.some((q) => q.isLoading),
    error: metric != null ? (queries.find((q) => q.error)?.error ?? null) : null,
    events,
    clients,
  };
}

interface Props {
  metric: DrillKey;
  accent: string;
  /** Position of the event the chat stands on; -1 for a row that is not one of them. */
  index: number;
  total: number;
  /** Neighbour events by time (-1: none), valid for a row outside the list too. */
  prev: number;
  next: number;
  loading: boolean;
  failed: boolean;
  /** The event's message is not in the feed (a chat granted for one desk only). */
  hidden: boolean;
  clientIndex: number;
  /** null: the client list is not loaded yet. */
  clientCount: number | null;
  onEvent: (index: number) => void;
  onClient: (step: -1 | 1) => void;
  onClose: () => void;
}

/** The bar above a conversation opened from a metric card: steps through its events and clients. */
export default function DrillNavigator(props: Props) {
  const { metric, index, total, prev, next, clientIndex, clientCount, onEvent, onClient, onClose } = props;
  const position = props.loading
    ? "загрузка"
    : props.failed
      ? "не загрузилось"
      : total === 0
        ? "событий нет"
        : index >= 0
          ? `${index + 1} из ${total}${props.hidden ? " · сообщение не видно" : ""}`
          : `вне списка, всего ${total}`;
  const known = clientCount != null;
  return (
    <div className="chat-nav" style={{ "--nav-accent": props.accent } as CSSProperties}>
      <span className="chat-nav-title">{EVENT_TITLES[metric]}</span>
      <span className="meta chat-nav-pos">{position}</span>
      <Button size="small" icon={<UpOutlined />} aria-label="Предыдущее событие" disabled={prev < 0} onClick={() => onEvent(prev)} />
      <Button size="small" icon={<DownOutlined />} aria-label="Следующее событие" disabled={next < 0} onClick={() => onEvent(next)} />
      <span className="chat-nav-gap" />
      {known && clientIndex >= 0 && <span className="meta">клиент {clientIndex + 1} из {clientCount}</span>}
      <Button
        size="small"
        icon={<LeftOutlined />}
        aria-label="Предыдущий клиент"
        disabled={known && clientIndex <= 0}
        onClick={() => onClient(-1)}
      />
      <Button
        size="small"
        aria-label="Следующий клиент"
        disabled={known && clientIndex >= clientCount - 1}
        onClick={() => onClient(1)}
      >
        Следующий клиент <RightOutlined />
      </Button>
      <Tooltip title="Закрыть навигацию">
        <Button size="small" type="text" icon={<CloseOutlined />} aria-label="Закрыть навигацию" onClick={onClose} />
      </Tooltip>
    </div>
  );
}
