import dayjs from "dayjs";
import type { ChatMessage, TicketDetail } from "../api/types";

/** The clickable cards of the metrics screen. */
export type DrillKey =
  | "messages"
  | "closed"
  | "rejected"
  | "open"
  | "unanswered"
  | "expired"
  | "fast"
  | "resolved"
  | "thanked"
  | "offHours";

const KEYS: DrillKey[] = [
  "messages",
  "closed",
  "rejected",
  "open",
  "unanswered",
  "expired",
  "fast",
  "resolved",
  "thanked",
  "offHours",
];

export const asDrillKey = (v: string | null): DrillKey | null =>
  KEYS.includes(v as DrillKey) ? (v as DrillKey) : null;

/** What the chat's event bar calls the metric it steps through. */
export const EVENT_TITLES: Record<DrillKey, string> = {
  messages: "Дни переписки",
  closed: "Закрытия",
  rejected: "Отклонения",
  open: "Открытые заявки",
  unanswered: "Без ответа",
  expired: "Истекли по тишине",
  fast: "Первый ответ дольше 15 мин",
  resolved: "Решено дольше часа",
  thanked: "Благодарности",
  // Messages closer than BURST_GAP_MINUTES make one run: the bar counts runs,
  // the drawer counts messages, and the title says which.
  offHours: "Серии вне рабочего времени",
};

/**
 * The tickets a ticket card is about and the moment the chat lands on: the
 * drawer's default list uses the same test, so the chat steps through
 * exactly the rows the drawer showed. The moments are message times: the
 * opening message, the closing one, or the last one before the silence.
 */
export const TICKET_EVENTS: Partial<
  Record<DrillKey, { cohort: "opened" | "closed"; test: (t: TicketDetail) => boolean; at: (t: TicketDetail) => string }>
> = {
  closed: { cohort: "closed", test: (t) => t.status === "closed", at: (t) => t.closedAt ?? t.openedAt },
  rejected: { cohort: "closed", test: (t) => t.status === "rejected", at: (t) => t.closedAt ?? t.openedAt },
  unanswered: { cohort: "opened", test: (t) => t.noReply && t.status !== "open", at: (t) => t.openedAt },
  expired: { cohort: "opened", test: (t) => t.status === "expired", at: (t) => t.lastActivity },
  fast: { cohort: "opened", test: (t) => t.answered && !t.answeredFast, at: (t) => t.openedAt },
  resolved: { cohort: "opened", test: (t) => t.resolved && !t.resolvedHour, at: (t) => t.openedAt },
  thanked: { cohort: "opened", test: (t) => t.status === "closed" && t.thanked, at: (t) => t.closedAt ?? t.openedAt },
};

/** Off-hours messages this close together are one sitting: one event, not one per message. */
export const BURST_GAP_MINUTES = 30;

/** The first message of every run of sorted times separated by quiet gaps. */
export function bursts(sortedTimes: string[]): string[] {
  const starts: string[] = [];
  let prev: string | null = null;
  for (const at of sortedTimes) {
    if (prev == null || dayjs(at).diff(prev, "minute") >= BURST_GAP_MINUTES) starts.push(at);
    prev = at;
  }
  return starts;
}

/** The first message of every day of the conversation: the events of the volume card. */
export function conversationDays(chats: ChatMessage[]): string[] {
  const days: string[] = [];
  let day = "";
  for (const m of chats) {
    if (m.createdAt.slice(0, 10) !== day) {
      day = m.createdAt.slice(0, 10);
      days.push(m.createdAt);
    }
  }
  return days;
}
