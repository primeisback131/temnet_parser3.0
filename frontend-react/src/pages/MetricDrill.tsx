import { useQueryClient } from "@tanstack/react-query";
import { Tag } from "antd";
import type { ColumnType } from "antd/es/table";
import dayjs from "dayjs";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useBacklogTickets, useClientMessages, useTicketDetails } from "../api/queries";
import type { BacklogReport, ClientMessages, OpenTicket, TicketDetail } from "../api/types";
import type { Breakdown, DrillSpec } from "../components/MetricDrawer";
import MetricDrawer from "../components/MetricDrawer";
import { chartColors } from "../lib/chartTheme";
import { humanizeSeconds } from "../lib/format";
import { useThemeMode } from "../theme";

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

/** Cards counted over the tickets opened in the period (the summary's population). */
const OPENED_COHORT: DrillKey[] = ["unanswered", "expired", "fast", "resolved", "thanked"];

/** The LIMIT of backlog_tickets.sql: this many rows means the list was cut. */
const OPEN_TICKETS_LIMIT = 1000;

interface Props {
  drill: DrillKey | null;
  onClose: () => void;
  start: string;
  end: string;
  group: string | null;
  backlog: BacklogReport | undefined;
  /** The client's name, a chat link where the account may read that chat. */
  clientCell: (client: string, groupNames: string | null, from: string) => ReactNode;
}

const num = (n: number) => n.toLocaleString("ru-RU");
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const at = (v: string | null) => (v ? dayjs(v).format("DD.MM.YYYY HH:mm") : "");
const count = <T,>(rows: T[], test: (row: T) => boolean) => rows.filter(test).length;
const CUT_TICKETS = "Список обрезан по лимиту сервера, показаны последние заявки: разбивки неполные, сузьте период";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** First bucket whose upper bound holds the value. */
function bucketOf(buckets: Array<[number, string]>, value: number | null): string | null {
  return value == null ? null : (buckets.find(([max]) => value <= max)?.[1] ?? null);
}

const FRT_BUCKETS: Array<[number, string]> = [
  [5 * 60, "до 5 мин"],
  [15 * 60, "5-15 мин"],
  [3600, "15-60 мин"],
  [4 * 3600, "1-4 ч"],
  [Infinity, "больше 4 ч"],
];

// Working seconds; a working day is 10 hours (BusinessTime).
const RESOLUTION_BUCKETS: Array<[number, string]> = [
  [3600, "до 1 ч"],
  [4 * 3600, "1-4 ч"],
  [10 * 3600, "4 ч - 1 раб. день"],
  [50 * 3600, "1-5 раб. дней"],
  [Infinity, "больше 5 раб. дней"],
];

// The age buckets of backlog.sql, in calendar days to the period end.
const AGE_BUCKETS: Array<[number, string]> = [
  [1, "до 1 дня"],
  [3, "2-3 дня"],
  [7, "4-7 дней"],
  [30, "8-30 дней"],
  [Infinity, "больше месяца"],
];

const labelsOf = (buckets: Array<[number, string]>) => buckets.map(([, label]) => label);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** When a ticket arrived relative to the Mon-Fri 08:00-18:00 working day. */
function arrival(openedAt: string): string {
  const d = dayjs(openedAt);
  if (d.day() === 0 || d.day() === 6) return "выходные";
  return d.hour() >= 8 && d.hour() < 18 ? "рабочее время" : "будни, вечер и ночь";
}
const ARRIVAL_ORDER = ["рабочее время", "будни, вечер и ночь", "выходные"];

/** Who left the expired ticket hanging. */
function silentSide(t: TicketDetail): string {
  if (t.noReply) return "поддержка, ни разу";
  return t.awaiting ? "поддержка, на последнее" : "клиент";
}
const SILENT_ORDER = ["поддержка, ни разу", "поддержка, на последнее", "клиент"];

const FINAL_STATUS: Record<OpenTicket["finalStatus"], string> = {
  open: "так и не закрыта",
  closed: "закрыта позже",
  rejected: "отклонена позже",
  expired: "истекла позже",
};

const byCategory = <T extends { category: string }>(): Breakdown<T> => ({
  title: "Категории",
  of: (t) => t.category,
});

type TicketField =
  | "client"
  | "opened"
  | "lastActivity"
  | "closed"
  | "category"
  | "messages"
  | "firstResponder"
  | "frt"
  | "closedBy"
  | "resolution"
  | "thanked"
  | "reopened"
  | "silent";

export default function MetricDrill({ drill, onClose, start, end, group, backlog, clientCell }: Props) {
  const { mode } = useThemeMode();
  const c = chartColors(mode);
  const queryClient = useQueryClient();

  const opened = useTicketDetails(start, end, "opened", group, drill != null && OPENED_COHORT.includes(drill));
  const closed = useTicketDetails(start, end, "closed", group, drill === "closed" || drill === "rejected");
  const messages = useClientMessages(start, end, group, drill === "messages" || drill === "offHours");
  const open = useBacklogTickets(end, group, drill === "open");

  // The cards were loaded with the page. When a list arrives fresh, reload
  // them too, so a card and its drawer describe the same moment (the office
  // server syncs every few minutes), and mark the other cached lists stale:
  // the cards are now newer than those, so the next drawer refetches its own.
  // A list served from cache within DRILL_STALE_MS can still trail cards that
  // reloaded on their own (leaving the page and coming back) by one sync.
  const fetchedAt = Math.max(opened.dataUpdatedAt, closed.dataUpdatedAt, messages.dataUpdatedAt, open.dataUpdatedAt);
  const seenAt = useRef(fetchedAt);
  useEffect(() => {
    if (fetchedAt <= seenAt.current) return;
    seenAt.current = fetchedAt;
    void queryClient.invalidateQueries({ queryKey: ["summary", start, end, group] });
    void queryClient.invalidateQueries({ queryKey: ["timeseries", start, end] });
    void queryClient.invalidateQueries({ queryKey: ["backlog", end, group] });
    void queryClient.invalidateQueries({
      predicate: (q) => ["ticketDetails", "clientMessages", "backlogTickets"].includes(String(q.queryKey[0])),
      refetchType: "none",
    });
  }, [fetchedAt, queryClient, start, end, group]);

  if (drill == null) return null;

  const subtitle =
    drill === "open"
      ? (group ?? "Все группы")
      : `${dayjs(start).format("DD.MM.YYYY")} - ${dayjs(end).format("DD.MM.YYYY")} · ${group ?? "все группы"}`;
  const fileName = `${drill}_${group ?? "all"}_${start}_${end}.xlsx`;
  const common = { subtitle, byGroup: group == null, onClose };
  const closedTitle = drill === "rejected" ? "Отклонена" : "Закрыта";
  const closedByTitle = drill === "rejected" ? "Отклонил" : "Закрыл";

  // Ticket columns shared by the ticket cards, each with its Excel columns.
  const field: Record<
    TicketField,
    { column: ColumnType<TicketDetail>; excel: (t: TicketDetail) => Record<string, unknown> }
  > = {
    client: {
      column: {
        title: "Клиент",
        dataIndex: "client",
        sorter: (a, b) => a.client.localeCompare(b.client),
        render: (client: string, t) => clientCell(client, t.groupNames, t.openedAt),
      },
      excel: (t) => ({ Клиент: t.client }),
    },
    opened: {
      column: {
        title: "Открыта",
        dataIndex: "openedAt",
        sorter: (a, b) => a.openedAt.localeCompare(b.openedAt),
        render: at,
      },
      excel: (t) => ({ Открыта: at(t.openedAt) }),
    },
    lastActivity: {
      column: {
        title: "Последнее сообщение",
        dataIndex: "lastActivity",
        sorter: (a, b) => a.lastActivity.localeCompare(b.lastActivity),
        render: at,
      },
      excel: (t) => ({ "Последнее сообщение": at(t.lastActivity) }),
    },
    closed: {
      column: {
        title: closedTitle,
        dataIndex: "closedAt",
        sorter: (a, b) => (a.closedAt ?? "").localeCompare(b.closedAt ?? ""),
        render: at,
      },
      excel: (t) => ({ [closedTitle]: at(t.closedAt) }),
    },
    category: { column: { title: "Категория", dataIndex: "category" }, excel: (t) => ({ Категория: t.category }) },
    messages: {
      column: {
        title: "Сообщений",
        key: "messages",
        align: "right",
        sorter: (a, b) => a.messagesIn + a.messagesOut - (b.messagesIn + b.messagesOut),
        render: (_, t) => `${t.messagesIn} / ${t.messagesOut}`,
      },
      excel: (t) => ({ "Сообщений клиента": t.messagesIn, "Сообщений поддержки": t.messagesOut }),
    },
    firstResponder: {
      column: { title: "Первым ответил", dataIndex: "firstResponder" },
      excel: (t) => ({ "Первым ответил": t.firstResponder ?? "" }),
    },
    frt: {
      column: {
        title: "Первый ответ",
        dataIndex: "frtSeconds",
        align: "right",
        defaultSortOrder: "descend",
        sorter: (a, b) => (a.frtSeconds ?? 0) - (b.frtSeconds ?? 0),
        render: humanizeSeconds,
      },
      excel: (t) => ({ "Первый ответ": humanizeSeconds(t.frtSeconds) }),
    },
    closedBy: {
      column: { title: closedByTitle, dataIndex: "closedBy" },
      excel: (t) => ({ [closedByTitle]: t.closedBy ?? "" }),
    },
    resolution: {
      column: {
        title: "Решение",
        dataIndex: "resolutionSeconds",
        align: "right",
        ...(drill === "resolved" ? { defaultSortOrder: "descend" as const } : {}),
        sorter: (a, b) => (a.resolutionSeconds ?? 0) - (b.resolutionSeconds ?? 0),
        render: humanizeSeconds,
      },
      excel: (t) => ({ Решение: humanizeSeconds(t.resolutionSeconds) }),
    },
    thanked: {
      column: {
        title: "Спасибо",
        dataIndex: "thanked",
        render: (v: boolean) => (v ? <Tag color="green">да</Tag> : null),
      },
      excel: (t) => ({ Спасибо: t.thanked ? "да" : "" }),
    },
    reopened: {
      column: {
        title: "Клиент вернулся",
        dataIndex: "reopened",
        render: (v: boolean) => (v ? <Tag color="orange">да</Tag> : null),
      },
      excel: (t) => ({ "Клиент вернулся": t.reopened ? "да" : "" }),
    },
    silent: {
      column: {
        title: "Кто не ответил",
        key: "silent",
        render: (_, t) => (t.status === "expired" ? silentSide(t) : null),
      },
      excel: (t) => ({ "Кто не ответил": t.status === "expired" ? silentSide(t) : "" }),
    },
  };

  /** A ticket card's spec: shared row identity, columns and Excel from the field list. */
  const tickets = (
    fields: TicketField[],
    spec: Omit<DrillSpec<TicketDetail>, "rowKey" | "groupOf" | "columns" | "excel" | "fileName">,
  ): DrillSpec<TicketDetail> => ({
    ...spec,
    rowKey: (t) => `${t.client}|${t.openedAt}`,
    groupOf: (t) => t.groupNames,
    columns: fields.map((f) => field[f].column),
    excel: (t) => Object.assign({}, ...fields.map((f) => field[f].excel(t))),
    fileName,
  });

  const cohortOf = (q: typeof opened) => ({
    rows: q.data?.tickets ?? [],
    loading: q.isLoading,
    error: q.error,
    truncated: q.data?.truncated ? CUT_TICKETS : null,
  });
  const cohort = cohortOf(opened);
  const closedCohort = cohortOf(closed);

  const clientColumn: ColumnType<ClientMessages> = {
    title: "Клиент",
    dataIndex: "client",
    sorter: (a, b) => a.client.localeCompare(b.client),
    render: (client: string, r) => clientCell(client, r.groupNames, start),
  };
  const clients = {
    rows: messages.data ?? [],
    loading: messages.isLoading,
    error: messages.error,
    rowKey: (r: ClientMessages) => r.client,
    groupOf: (r: ClientMessages) => r.groupNames,
    fileName,
  };

  switch (drill) {
    case "messages":
      return (
        <MetricDrawer<ClientMessages>
          {...common}
          spec={{
            ...clients,
            title: "Сообщения",
            accent: c.blue,
            count: (r) => r.messagesIn + r.messagesOut,
            countTitle: "Сообщений",
            facts: (rows) => {
              const inTotal = rows.reduce((n, r) => n + r.messagesIn, 0);
              const outTotal = rows.reduce((n, r) => n + r.messagesOut, 0);
              return [
                { label: "Всего", value: num(inTotal + outTotal) },
                { label: "От клиентов", value: num(inTotal), hint: `${pct(inTotal, inTotal + outTotal)}%` },
                { label: "От поддержки", value: num(outTotal), hint: `${pct(outTotal, inTotal + outTotal)}%` },
                { label: "Клиентов", value: num(rows.length) },
              ];
            },
            breakdowns: [],
            columns: [
              clientColumn,
              {
                title: "От клиента",
                dataIndex: "messagesIn",
                align: "right",
                sorter: (a, b) => a.messagesIn - b.messagesIn,
              },
              {
                title: "От поддержки",
                dataIndex: "messagesOut",
                align: "right",
                sorter: (a, b) => a.messagesOut - b.messagesOut,
              },
              {
                title: "Всего",
                key: "total",
                align: "right",
                defaultSortOrder: "descend",
                sorter: (a, b) => a.messagesIn + a.messagesOut - (b.messagesIn + b.messagesOut),
                render: (_, r) => num(r.messagesIn + r.messagesOut),
              },
            ],
            excel: (r) => ({
              Клиент: r.client,
              "От клиента": r.messagesIn,
              "От поддержки": r.messagesOut,
              Всего: r.messagesIn + r.messagesOut,
            }),
          }}
        />
      );

    case "offHours": {
      const off = (r: ClientMessages) => r.offHoursNight + r.offHoursWeekend;
      return (
        <MetricDrawer<ClientMessages>
          {...common}
          spec={{
            ...clients,
            title: "Вне рабочего времени",
            accent: c.cyan,
            count: off,
            countTitle: "Вне рабочего времени",
            base: (r) => r.messagesIn,
            baseTitle: "Входящих",
            rateTitle: "Доля вне рабочего времени",
            facts: (rows) => {
              const incoming = rows.reduce((n, r) => n + r.messagesIn, 0);
              const night = rows.reduce((n, r) => n + r.offHoursNight, 0);
              const weekend = rows.reduce((n, r) => n + r.offHoursWeekend, 0);
              return [
                {
                  label: "Вне рабочего времени",
                  value: num(night + weekend),
                  hint: `${pct(night + weekend, incoming)}% входящих`,
                },
                { label: "Будни, вечер и ночь", value: num(night) },
                { label: "Выходные", value: num(weekend) },
                { label: "Входящих", value: num(incoming) },
              ];
            },
            breakdowns: [],
            focus: { label: "Писали вне рабочего времени", test: (r) => off(r) > 0 },
            columns: [
              clientColumn,
              {
                title: "Вне рабочего времени",
                key: "off",
                align: "right",
                defaultSortOrder: "descend",
                sorter: (a, b) => off(a) - off(b),
                render: (_, r) => num(off(r)),
              },
              {
                title: "Будни, вечер и ночь",
                dataIndex: "offHoursNight",
                align: "right",
                sorter: (a, b) => a.offHoursNight - b.offHoursNight,
              },
              {
                title: "Выходные",
                dataIndex: "offHoursWeekend",
                align: "right",
                sorter: (a, b) => a.offHoursWeekend - b.offHoursWeekend,
              },
              {
                title: "Входящих",
                dataIndex: "messagesIn",
                align: "right",
                sorter: (a, b) => a.messagesIn - b.messagesIn,
              },
              {
                title: "Доля",
                key: "share",
                align: "right",
                sorter: (a, b) => pct(off(a), a.messagesIn) - pct(off(b), b.messagesIn),
                render: (_, r) => `${pct(off(r), r.messagesIn)}%`,
              },
            ],
            excel: (r) => ({
              Клиент: r.client,
              "Вне рабочего времени": off(r),
              "Будни, вечер и ночь": r.offHoursNight,
              Выходные: r.offHoursWeekend,
              Входящих: r.messagesIn,
              "Доля, %": pct(off(r), r.messagesIn),
            }),
          }}
        />
      );
    }

    case "closed":
      return (
        <MetricDrawer<TicketDetail>
          {...common}
          spec={tickets(["client", "opened", "closed", "closedBy", "resolution", "category", "thanked", "reopened"], {
            ...closedCohort,
            rows: closedCohort.rows.filter((t) => t.status === "closed"),
            title: "Закрытые заявки",
            accent: c.green,
            count: () => 1,
            countTitle: "Закрыто",
            facts: (rows) => [
              { label: "Закрыто", value: num(rows.length), hint: "по дате закрытия" },
              {
                label: "Решение",
                value: humanizeSeconds(median(rows.filter((t) => t.resolved).map((t) => t.resolutionSeconds!))),
                hint: "медиана, рабочее время",
              },
              {
                label: "Со «спасибо»",
                value: `${pct(count(rows, (t) => t.thanked), rows.length)}%`,
                hint: `${num(count(rows, (t) => t.thanked))}, по дате закрытия`,
              },
              {
                label: "Клиент вернулся",
                value: `${pct(count(rows, (t) => t.reopened), rows.length)}%`,
                hint: num(count(rows, (t) => t.reopened)),
              },
            ],
            breakdowns: [
              { title: "Кто закрыл", of: (t) => t.closedBy ?? "не указан" },
              {
                title: "Время решения",
                of: (t) => bucketOf(RESOLUTION_BUCKETS, t.resolutionSeconds),
                order: labelsOf(RESOLUTION_BUCKETS),
              },
              byCategory(),
            ],
          })}
        />
      );

    case "rejected":
      return (
        <MetricDrawer<TicketDetail>
          {...common}
          spec={tickets(["client", "opened", "closed", "closedBy", "category", "messages"], {
            ...closedCohort,
            rows: closedCohort.rows.filter((t) => t.status === "rejected"),
            title: "Отклонённые заявки",
            accent: c.rose,
            count: () => 1,
            countTitle: "Отклонено",
            facts: (rows) => [{ label: "Отклонено", value: num(rows.length), hint: "по дате отклонения" }],
            breakdowns: [{ title: "Кто отклонил", of: (t) => t.closedBy ?? "не указан" }, byCategory()],
          })}
        />
      );

    case "open": {
      const rows = open.data ?? [];
      return (
        <MetricDrawer<OpenTicket>
          {...common}
          spec={{
            title: `Открытые заявки на ${dayjs(backlog?.asOf ?? end).format("DD.MM.YYYY")}`,
            accent: c.amber,
            rows,
            loading: open.isLoading,
            error: open.error,
            truncated:
              rows.length >= OPEN_TICKETS_LIMIT
                ? `Загружены ${num(rows.length)} самых свежих заявок, остальные не показаны: разбивки неполные`
                : null,
            rowKey: (t) => `${t.client}|${t.openedAt}`,
            groupOf: (t) => t.groupNames,
            count: () => 1,
            countTitle: "Открыто",
            facts: (rows) => {
              const oldest = rows.reduce<string | null>((m, t) => (m == null || t.openedAt < m ? t.openedAt : m), null);
              return [
                { label: "Открыто", value: num(rows.length) },
                ...labelsOf(AGE_BUCKETS).map((label) => ({
                  label: capital(label),
                  value: num(count(rows, (t) => bucketOf(AGE_BUCKETS, t.ageDays) === label)),
                })),
                ...(oldest ? [{ label: "Самая старая", value: dayjs(oldest).format("DD.MM.YYYY") }] : []),
              ];
            },
            breakdowns: [
              { title: "Возраст", of: (t) => bucketOf(AGE_BUCKETS, t.ageDays), order: labelsOf(AGE_BUCKETS) },
              byCategory(),
              { title: "Первым ответил", of: (t) => t.firstResponder ?? "никто" },
              { title: "Что дальше", of: (t) => FINAL_STATUS[t.finalStatus], order: Object.values(FINAL_STATUS) },
            ],
            columns: [
              {
                title: "Клиент",
                dataIndex: "client",
                sorter: (a, b) => a.client.localeCompare(b.client),
                render: (client: string, t) => clientCell(client, t.groupNames, t.openedAt),
              },
              {
                title: "Открыта",
                dataIndex: "openedAt",
                defaultSortOrder: "ascend",
                sorter: (a, b) => a.openedAt.localeCompare(b.openedAt),
                render: at,
              },
              {
                title: "Последнее сообщение",
                dataIndex: "lastActivity",
                sorter: (a, b) => a.lastActivity.localeCompare(b.lastActivity),
                render: at,
              },
              { title: "Категория", dataIndex: "category" },
              {
                title: "Сообщений",
                key: "messages",
                align: "right",
                sorter: (a, b) => a.messagesIn + a.messagesOut - (b.messagesIn + b.messagesOut),
                render: (_, t) => `${t.messagesIn} / ${t.messagesOut}`,
              },
              { title: "Первым ответил", dataIndex: "firstResponder" },
              {
                title: "Что дальше",
                key: "outcome",
                render: (_, t) =>
                  t.finalStatus === "open" ? (
                    <Tag color="orange">так и не закрыта</Tag>
                  ) : (
                    `${FINAL_STATUS[t.finalStatus]}${t.closedAt ? ` ${dayjs(t.closedAt).format("DD.MM.YYYY")}` : ""}`
                  ),
              },
            ],
            excel: (t) => ({
              Клиент: t.client,
              Открыта: at(t.openedAt),
              "Последнее сообщение": at(t.lastActivity),
              Категория: t.category,
              "Сообщений клиента": t.messagesIn,
              "Сообщений поддержки": t.messagesOut,
              "Первым ответил": t.firstResponder ?? "",
              "Что дальше": FINAL_STATUS[t.finalStatus],
              "Закрыта позже": at(t.closedAt),
            }),
            fileName: `open_tickets_${group ?? "all"}_${dayjs(backlog?.asOf ?? end).format("YYYY-MM-DD")}.xlsx`,
          }}
        />
      );
    }

    case "unanswered":
      return (
        <MetricDrawer<TicketDetail>
          {...common}
          spec={tickets(["client", "opened", "lastActivity", "category", "messages"], {
            ...cohort,
            title: "Без ответа",
            accent: c.rose,
            count: (t) => (t.noReply ? 1 : 0),
            countTitle: "Без ответа",
            base: (t) => (t.status !== "open" ? 1 : 0),
            baseTitle: "Завершено",
            rateTitle: "Доля без ответа",
            facts: (rows) => {
              const hits = count(rows, (t) => t.noReply);
              return [
                { label: "Без ответа", value: num(hits), hint: `${pct(hits, rows.length)}% завершённых` },
                {
                  label: "Пришли вне рабочего времени",
                  value: `${pct(count(rows, (t) => t.noReply && arrival(t.openedAt) !== "рабочее время"), hits)}%`,
                },
              ];
            },
            breakdowns: [
              { title: "Когда пришла", of: (t) => arrival(t.openedAt), order: ARRIVAL_ORDER },
              byCategory(),
            ],
            focus: { label: "Без ответа", test: (t) => t.noReply },
          })}
        />
      );

    case "expired":
      return (
        <MetricDrawer<TicketDetail>
          {...common}
          spec={tickets(["client", "opened", "lastActivity", "silent", "firstResponder", "category", "messages"], {
            ...cohort,
            title: "Истекли по тишине",
            accent: c.amber,
            count: (t) => (t.status === "expired" ? 1 : 0),
            countTitle: "Истекли",
            base: () => 1,
            baseTitle: "Заявок за период",
            rateTitle: "Доля истёкших",
            facts: (rows) => {
              const expired = rows.filter((t) => t.status === "expired");
              const clientSilent = count(expired, (t) => silentSide(t) === "клиент");
              return [
                {
                  label: "Истекли",
                  value: num(expired.length),
                  hint: `${pct(expired.length, rows.length)}% заявок за период`,
                },
                {
                  label: "Молчала поддержка",
                  value: num(expired.length - clientSilent),
                  hint: `${pct(expired.length - clientSilent, expired.length)}% истёкших`,
                },
                {
                  label: "Молчал клиент",
                  value: num(clientSilent),
                  hint: `${pct(clientSilent, expired.length)}% истёкших`,
                },
              ];
            },
            breakdowns: [
              {
                title: "Кто не ответил",
                of: (t) => (t.status === "expired" ? silentSide(t) : null),
                order: SILENT_ORDER,
                mode: "share",
              },
              { title: "Первым ответил", of: (t) => t.firstResponder },
              byCategory(),
            ],
            focus: { label: "Истекли", test: (t) => t.status === "expired" },
          })}
        />
      );

    case "fast":
      return (
        <MetricDrawer<TicketDetail>
          {...common}
          spec={tickets(["client", "opened", "frt", "firstResponder", "category"], {
            ...cohort,
            title: "Первый ответ за 15 мин",
            accent: c.green,
            count: (t) => (t.answeredFast ? 1 : 0),
            countTitle: "За 15 мин",
            base: (t) => (t.answered ? 1 : 0),
            baseTitle: "Отвечено",
            rateTitle: "Доля за 15 мин",
            facts: (rows) => [
              {
                label: "За 15 мин",
                value: `${pct(count(rows, (t) => t.answeredFast), rows.length)}%`,
                hint: num(count(rows, (t) => t.answeredFast)),
              },
              {
                label: "За час",
                value: `${pct(count(rows, (t) => t.answeredHour), rows.length)}%`,
                hint: num(count(rows, (t) => t.answeredHour)),
              },
              {
                label: "Первый ответ",
                value: humanizeSeconds(median(rows.map((t) => t.frtSeconds!))),
                hint: "медиана, рабочее время",
              },
              { label: "Отвечено", value: num(rows.length) },
            ],
            breakdowns: [
              {
                title: "Время первого ответа",
                of: (t) => bucketOf(FRT_BUCKETS, t.frtSeconds),
                order: labelsOf(FRT_BUCKETS),
                mode: "spread",
              },
              { title: "Первым ответил", of: (t) => t.firstResponder },
              byCategory(),
            ],
            focus: { label: "Дольше 15 мин", test: (t) => !t.answeredFast },
          })}
        />
      );

    case "resolved":
      return (
        <MetricDrawer<TicketDetail>
          {...common}
          spec={tickets(["client", "opened", "closed", "resolution", "closedBy", "category"], {
            ...cohort,
            title: "Решено за час",
            accent: c.blue,
            count: (t) => (t.resolvedHour ? 1 : 0),
            countTitle: "За час",
            base: (t) => (t.resolved ? 1 : 0),
            baseTitle: "Решено",
            rateTitle: "Доля за час",
            facts: (rows) => [
              {
                label: "За час",
                value: `${pct(count(rows, (t) => t.resolvedHour), rows.length)}%`,
                hint: num(count(rows, (t) => t.resolvedHour)),
              },
              {
                label: "За рабочий день",
                value: `${pct(count(rows, (t) => t.resolvedDay), rows.length)}%`,
                hint: num(count(rows, (t) => t.resolvedDay)),
              },
              {
                label: "Решение",
                value: humanizeSeconds(median(rows.map((t) => t.resolutionSeconds!))),
                hint: "медиана, рабочее время",
              },
              { label: "Решено", value: num(rows.length) },
            ],
            breakdowns: [
              {
                title: "Время решения",
                of: (t) => bucketOf(RESOLUTION_BUCKETS, t.resolutionSeconds),
                order: labelsOf(RESOLUTION_BUCKETS),
                mode: "spread",
              },
              { title: "Кто закрыл", of: (t) => t.closedBy },
              byCategory(),
            ],
            focus: { label: "Дольше часа", test: (t) => !t.resolvedHour },
          })}
        />
      );

    case "thanked":
      return (
        <MetricDrawer<TicketDetail>
          {...common}
          spec={tickets(["client", "opened", "closed", "closedBy", "resolution", "category", "thanked"], {
            ...cohort,
            title: "Благодарности",
            accent: c.violet,
            count: (t) => (t.thanked ? 1 : 0),
            countTitle: "Со «спасибо»",
            base: (t) => (t.status === "closed" ? 1 : 0),
            baseTitle: "Закрыто из заявок за период",
            rateTitle: "Доля со «спасибо»",
            facts: (rows) => {
              const thanked = count(rows, (t) => t.thanked);
              return [
                { label: "Со «спасибо»", value: num(thanked), hint: `${pct(thanked, rows.length)}% закрытых` },
                { label: "Закрыто из заявок за период", value: num(rows.length) },
              ];
            },
            breakdowns: [{ title: "Кто закрыл", of: (t) => t.closedBy }, byCategory()],
            focus: { label: "Со «спасибо»", test: (t) => t.thanked },
          })}
        />
      );
  }
}
