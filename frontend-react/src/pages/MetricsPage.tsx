import {
  CheckCircleOutlined,
  FieldTimeOutlined,
  FileExcelOutlined,
  HourglassOutlined,
  InboxOutlined,
  LikeOutlined,
  MessageOutlined,
  MoonOutlined,
  QuestionCircleOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { BarSeriesOption, EChartsOption, LineSeriesOption } from "echarts";
import dayjs from "dayjs";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useAlerts,
  useBacklog,
  useBacklogTickets,
  useCategories,
  useCategoryTimeseries,
  useClients,
  useGroups,
  useHeatmap,
  useReopens,
  useResolution,
  useSla,
  useSummary,
  useTimeseries,
} from "../api/queries";
import type { Bucket, CategoryCount, ClientStat, OpenTicket } from "../api/types";
import EChart from "../components/EChart";
import QueryError from "../components/QueryError";
import StatCard from "../components/StatCard";
import { areaFade, barFade, barFadeX, chartColors, dot, legendTop } from "../lib/chartTheme";
import { defaultRange, toApiDate } from "../lib/date";
import { exportToExcel } from "../lib/excel";
import { humanizeSeconds } from "../lib/format";
import { tint } from "../lib/palette";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useThemeMode } from "../theme";

const { RangePicker } = DatePicker;

const BUCKET_NOUN: Record<Bucket, string> = { day: "день", week: "неделю", month: "месяц" };

/** Whole-percent share; null when there is nothing to divide by. */
function pct(part: number | undefined, whole: number | undefined): number | null {
  return whole && whole > 0 ? Math.round(((part ?? 0) / whole) * 100) : null;
}

/** What the category bars measure; requests is the default view. */
type CategoryMode = "requests" | "frt" | "resolution" | "messages" | "reopens";
const CATEGORY_VALUE: Record<CategoryMode, (c: CategoryCount) => number> = {
  requests: (c) => c.requests,
  frt: (c) => +((c.p50FrtSeconds ?? 0) / 60).toFixed(1),
  resolution: (c) => +((c.p50ResolutionSeconds ?? 0) / 3600).toFixed(1),
  messages: (c) => +c.avgMessages.toFixed(1),
  reopens: (c) => pct(c.reopens, c.requests) ?? 0,
};
const CATEGORY_UNIT: Record<CategoryMode, string> = {
  requests: "заявок",
  frt: "мин до первого ответа (медиана)",
  resolution: "раб. ч до закрытия (медиана)",
  messages: "сообщений на заявку",
  reopens: "% повторных",
};

/** How many top categories get their own series in the trend chart; the rest are pooled. */
const TREND_TOP = 6;

/** Line series with the app's stroke weight and hover behaviour. */
function line(
  name: string,
  color: string,
  values: number[],
  extra: Partial<LineSeriesOption> = {},
): LineSeriesOption {
  return {
    name,
    type: "line",
    smooth: 0.35,
    showSymbol: false,
    symbolSize: 7,
    lineStyle: { width: 2.4, color },
    itemStyle: { color },
    emphasis: { focus: "series", scale: 1.3 },
    data: values,
    ...extra,
  } as LineSeriesOption;
}

/**
 * Two invisible stacked series that shade the gap between the typical and
 * the slow case, so the p50/p90 spread reads as a band instead of two lines.
 */
function spreadBand(low: number[], high: number[], color: string): LineSeriesOption[] {
  const base: Partial<LineSeriesOption> = {
    type: "line",
    stack: "spread",
    silent: true,
    symbol: "none",
    smooth: 0.35,
    lineStyle: { opacity: 0 },
    tooltip: { show: false },
    z: 1,
  };
  return [
    { ...base, name: "spread-base", data: low, areaStyle: { opacity: 0 } } as LineSeriesOption,
    {
      ...base,
      name: "spread-fill",
      data: high.map((v, i) => Math.max(0, v - low[i])),
      areaStyle: { color: tint(color, 0.16) },
    } as LineSeriesOption,
  ];
}

export default function MetricsPage() {
  const { mode } = useThemeMode();
  const [[start, end], setRange] = useState(defaultRange);
  const [group, setGroup] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket>("day");
  const [heatmapMode, setHeatmapMode] = useState<"sum" | "avg">("sum");
  const [categoryMode, setCategoryMode] = useState<CategoryMode>("requests");
  const c = chartColors(mode);
  // Below this the legend of a two-axis chart spans the full width and would
  // run into the axis names sitting in the top corners, so those are dropped
  // (the tooltip still names every series).
  const narrow = useMediaQuery("(max-width: 700px)");
  const unit = useMemo(() => (name: string) => (narrow ? {} : { name }), [narrow]);
  const gridTop = narrow ? 66 : 44;

  const startStr = toApiDate(start);
  const endStr = toApiDate(end);

  const { data: groups = [], error: groupsError } = useGroups();
  const { data = [], isFetching, error: timeseriesError } = useTimeseries(startStr, endStr, bucket, group);
  const { data: heatmap = [], isFetching: heatmapLoading, error: heatmapError } = useHeatmap(startStr, endStr, group);
  const { data: sla = [], isFetching: slaLoading, error: slaError } = useSla(startStr, endStr, bucket, group);
  const {
    data: resolution = [],
    isFetching: resolutionLoading,
    error: resolutionError,
  } = useResolution(startStr, endStr, bucket, group);
  const { data: reopens = [], isFetching: reopensLoading, error: reopensError } = useReopens(startStr, endStr, bucket, group);
  const { data: alertsReport, error: alertsError } = useAlerts();
  const { data: summary, error: summaryError } = useSummary(startStr, endStr, group);
  const { data: topClients = [], isFetching: clientsLoading, error: clientsError } = useClients(
    startStr,
    endStr,
    group,
  );
  const {
    data: categoryTrend = [],
    isFetching: categoryTrendLoading,
    error: categoryTrendError,
  } = useCategoryTimeseries(startStr, endStr, bucket, group);
  const { data: backlog, error: backlogError } = useBacklog(endStr, group);
  // The period reaches past the data: the count describes the last day with
  // messages, not the requested end.
  const backlogClamped = backlog != null && dayjs(backlog.asOf).isBefore(dayjs(endStr), "day");
  const [openTicketsShown, setOpenTicketsShown] = useState(false);
  const { data: openTickets = [], isFetching: openTicketsLoading } = useBacklogTickets(
    endStr,
    group,
    openTicketsShown,
  );

  /** Deep link to a client's conversation on the chat screen, from a given date. */
  const chatLink = (client: string, groupNames: string | null, from: string) => {
    // A client can belong to several groups; the chat screen shows one at a time.
    const chatGroup = group ?? groupNames?.split(",")[0]?.trim() ?? "";
    const params = new URLSearchParams({
      group: chatGroup,
      user: client,
      start: dayjs(from).format("YYYY-MM-DD"),
      end: endStr,
    });
    return `/chat?${params}`;
  };

  const openTicketColumns: ColumnsType<OpenTicket> = [
    {
      title: "Клиент",
      dataIndex: "client",
      sorter: (a, b) => a.client.localeCompare(b.client),
      render: (client: string, t) => (
        <Link to={chatLink(client, t.groupNames, t.openedAt)} target="_blank">
          {client}
        </Link>
      ),
    },
    { title: "Группа", dataIndex: "groupNames" },
    {
      title: "Открыта",
      dataIndex: "openedAt",
      defaultSortOrder: "ascend",
      sorter: (a, b) => a.openedAt.localeCompare(b.openedAt),
      render: (v: string) => dayjs(v).format("DD.MM.YYYY HH:mm"),
    },
    {
      title: "Последнее сообщение",
      dataIndex: "lastActivity",
      sorter: (a, b) => a.lastActivity.localeCompare(b.lastActivity),
      render: (v: string) => dayjs(v).format("DD.MM.YYYY HH:mm"),
    },
    { title: "Категория", dataIndex: "category" },
    {
      title: "Сообщений",
      key: "messages",
      sorter: (a, b) => a.messagesIn + a.messagesOut - (b.messagesIn + b.messagesOut),
      render: (_, t) => `${t.messagesIn} / ${t.messagesOut}`,
    },
    { title: "Первым ответил", dataIndex: "firstResponder" },
    {
      title: "Что дальше",
      key: "outcome",
      filters: [
        { text: "Так и не закрыта", value: "open" },
        { text: "Закрыта позже", value: "closed" },
        { text: "Отклонена позже", value: "rejected" },
        { text: "Истекла позже", value: "expired" },
      ],
      onFilter: (value, t) => t.finalStatus === value,
      render: (_, t) => {
        if (t.finalStatus === "open") return <Tag color="orange">так и не закрыта</Tag>;
        const label =
          t.finalStatus === "closed"
            ? "закрыта"
            : t.finalStatus === "rejected"
              ? "отклонена"
              : "истекла";
        return (
          <span>
            {label}
            {t.closedAt ? ` ${dayjs(t.closedAt).format("DD.MM.YYYY")}` : ""}
          </span>
        );
      },
    },
  ];
  const clientColumns: ColumnsType<ClientStat> = [
    {
      title: "Клиент",
      dataIndex: "client",
      render: (client: string, r) => (
        <Link to={chatLink(client, r.groupNames, startStr)} target="_blank">
          {client}
        </Link>
      ),
    },
    { title: "Группа", dataIndex: "groupNames", ellipsis: true },
    { title: "Заявок", dataIndex: "tickets", align: "right", sorter: (a, b) => a.tickets - b.tickets },
    { title: "Сообщений", dataIndex: "messages", align: "right", sorter: (a, b) => a.messages - b.messages },
    { title: "Повторных", dataIndex: "reopens", align: "right", sorter: (a, b) => a.reopens - b.reopens },
    {
      title: "",
      dataIndex: "newClient",
      width: 70,
      render: (v: boolean) => (v ? <Tag color="blue">новый</Tag> : null),
    },
  ];

  const {
    data: categories = [],
    isFetching: categoriesLoading,
    error: categoriesError,
  } = useCategories(startStr, endStr, group);

  // Every widget falls back to empty data on failure; one banner says why.
  const firstError =
    groupsError ??
    timeseriesError ??
    backlogError ??
    slaError ??
    resolutionError ??
    reopensError ??
    heatmapError ??
    categoriesError ??
    categoryTrendError ??
    summaryError ??
    clientsError ??
    alertsError;

  const categoryStats = useMemo(() => {
    const named = categories.filter((c) => c.category !== "Другое");
    const other = categories.find((c) => c.category === "Другое")?.requests ?? 0;
    const total = categories.reduce((n, c) => n + c.requests, 0);
    const classifiedPct = total > 0 ? Math.round(((total - other) / total) * 100) : 0;
    return { named, other, classifiedPct };
  }, [categories]);

  // Overall first-response time. Both values are weighted by responses per
  // bucket; the "median" is therefore a weighted average of per-bucket p50s
  // (a stable "typical SLA" proxy), not a true overall median - the label
  // says so. The mean is shown secondarily because it is inflated by slow
  // cross-day replies.
  const overallFrt = useMemo(() => {
    const totalResponses = sla.reduce((n, p) => n + p.responses, 0);
    if (totalResponses === 0) return null;
    const mean = sla.reduce((n, p) => n + p.avgSeconds * p.responses, 0) / totalResponses;
    const median = sla.reduce((n, p) => n + p.p50Seconds * p.responses, 0) / totalResponses;
    return { mean, median };
  }, [sla]);

  const totals = useMemo(
    () =>
      data.reduce(
        (acc, p) => ({
          messages: acc.messages + p.messages,
          closed: acc.closed + p.closed,
          rejected: acc.rejected + p.rejected,
        }),
        { messages: 0, closed: 0, rejected: 0 },
      ),
    [data],
  );

  const perBucket = data.length > 0 ? Math.round(totals.messages / data.length) : 0;

  const labelFormat = bucket === "month" ? "MMM YYYY" : "DD MMM";
  const num = (n: number) => n.toLocaleString("ru-RU");

  const option = useMemo<EChartsOption>(() => {
    const labels = data.map((p) => dayjs(p.bucket).format(labelFormat));
    return {
      tooltip: { trigger: "axis" },
      legend: { data: ["Сообщения", "Закрытые", "Отклонённые", "Открытые"], ...legendTop },
      grid: { left: 16, right: 16, top: gridTop, bottom: 56, containLabel: true },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 10 }],
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        axisLabel: { hideOverlap: true },
      },
      yAxis: [
        { type: "value", ...unit("заявки") },
        { type: "value", ...unit("сообщения"), position: "right", splitLine: { show: false } },
      ],
      series: [
        line("Сообщения", c.blue, data.map((p) => p.messages), {
          yAxisIndex: 1,
          lineStyle: { width: 1.5, color: c.blue, opacity: 0.85 },
          areaStyle: { color: areaFade(c.blue) },
          z: 1,
        }),
        line("Закрытые", c.green, data.map((p) => p.closed), { z: 3 }),
        line("Отклонённые", c.rose, data.map((p) => p.rejected), { z: 3 }),
        line("Открытые", c.amber, data.map((p) => p.backlog), { z: 2 }),
      ],
    };
  }, [data, labelFormat, c, unit, gridTop]);

  const categoriesOption = useMemo<EChartsOption>(() => {
    const named = categoryStats.named;
    const value = CATEGORY_VALUE[categoryMode];
    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params) => {
          const arr = params as unknown as Array<{ dataIndex: number }>;
          const cat = named[arr[0].dataIndex];
          return (
            `<div style="margin-bottom:6px;font-weight:600">${cat.category}</div>` +
            `${num(cat.requests)} заявок<br/>` +
            `первый ответ ${humanizeSeconds(cat.p50FrtSeconds)} · решение ${humanizeSeconds(cat.p50ResolutionSeconds)}<br/>` +
            `${cat.avgMessages.toFixed(1)} сообщ. на заявку · повторных ${pct(cat.reopens, cat.requests) ?? 0}%` +
            (cat.unanswered > 0 ? `<br/>без ответа: ${cat.unanswered}` : "")
          );
        },
      },
      grid: { left: 14, right: 48, top: 8, bottom: 4, containLabel: true },
      xAxis: { type: "value", axisLabel: { show: false }, splitLine: { show: false } },
      yAxis: {
        type: "category",
        data: named.map((item) => item.category),
        inverse: true,
        axisLabel: { color: c.muted, fontSize: 12 },
      },
      series: [
        {
          type: "bar",
          data: named.map(value),
          barMaxWidth: 18,
          itemStyle: { color: barFadeX(c.blue), borderRadius: [0, 6, 6, 0] },
          emphasis: { itemStyle: { color: c.blue } },
          label: { show: true, position: "right", color: c.muted, fontSize: 12 },
        },
      ],
    };
  }, [categoryStats, categoryMode, c]);

  // Stacked bars per bucket for the biggest categories; the tail is pooled so
  // the legend stays readable whatever the dictionary grows to.
  const categoryTrendOption = useMemo<EChartsOption>(() => {
    const totals = new Map<string, number>();
    for (const p of categoryTrend) totals.set(p.category, (totals.get(p.category) ?? 0) + p.requests);
    const top = [...totals.entries()]
      .filter(([name]) => name !== "Другое")
      .sort((a, b) => b[1] - a[1])
      .slice(0, TREND_TOP)
      .map(([name]) => name);
    const buckets = [...new Set(categoryTrend.map((p) => p.bucket))].sort();
    const names = [...top, "Прочие"];
    const table = new Map(names.map((name) => [name, buckets.map(() => 0)]));
    for (const p of categoryTrend) {
      const row = table.get(top.includes(p.category) ? p.category : "Прочие")!;
      row[buckets.indexOf(p.bucket)] += p.requests;
    }
    const palette = [c.blue, c.green, c.amber, c.rose, c.violet, c.cyan, c.faint];
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { data: names, ...legendTop },
      grid: { left: 16, right: 16, top: gridTop, bottom: 52, containLabel: true },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 8 }],
      xAxis: { type: "category", data: buckets.map((b) => dayjs(b).format(labelFormat)), axisLabel: { hideOverlap: true } },
      yAxis: { type: "value", ...unit("заявки") },
      series: names.map(
        (name, i): BarSeriesOption => ({
          name,
          type: "bar",
          stack: "categories",
          barMaxWidth: 26,
          itemStyle: { color: name === "Прочие" ? tint(palette[i], 0.6) : palette[i] },
          emphasis: { focus: "series" },
          data: table.get(name),
        }),
      ),
    };
  }, [categoryTrend, labelFormat, c, unit, gridTop]);

  // One horizontal stacked bar: how the period's tickets ended.
  const outcomesOption = useMemo<EChartsOption>(() => {
    const parts: Array<[string, number, string]> = [
      ["Закрыты", summary?.closed ?? 0, c.green],
      ["Отклонены", summary?.rejected ?? 0, c.rose],
      ["Истекли по тишине", summary?.expired ?? 0, c.amber],
      ["Ещё открыты", summary?.stillOpen ?? 0, c.blue],
    ];
    const total = summary?.opened ?? 0;
    return {
      tooltip: {
        trigger: "item",
        formatter: (p) => {
          const { seriesName, value } = p as { seriesName: string; value: number };
          return `${seriesName}: <b>${num(value)}</b> (${pct(value, total) ?? 0}%)`;
        },
      },
      legend: { data: parts.map((p) => p[0]), ...legendTop },
      grid: { left: 0, right: 0, top: 34, bottom: 0 },
      xAxis: { type: "value", show: false, max: total || 1 },
      yAxis: { type: "category", data: [""], show: false },
      series: parts.map(
        ([name, value, color]): BarSeriesOption => ({
          name,
          type: "bar",
          stack: "outcomes",
          barWidth: 22,
          itemStyle: { color, borderRadius: 4 },
          label: {
            show: true,
            color: c.surface,
            fontSize: 12,
            fontWeight: 600,
            formatter: ({ value: v }) => ((v as number) / (total || 1) >= 0.08 ? num(v as number) : ""),
          },
          data: [value],
        }),
      ),
    };
  }, [summary, c]);

  const backlogOlder = (backlog?.ageMonth ?? 0) + (backlog?.ageOlder ?? 0);

  const slaOption = useMemo<EChartsOption>(() => {
    const labels = sla.map((p) => dayjs(p.bucket).format(labelFormat));
    const p50 = sla.map((p) => +(p.p50Seconds / 60).toFixed(1));
    const p90 = sla.map((p) => +(p.p90Seconds / 60).toFixed(1));
    return {
      tooltip: {
        trigger: "axis",
        formatter: (params) => {
          const arr = params as unknown as Array<{ axisValue: string; dataIndex: number }>;
          const p = sla[arr[0].dataIndex];
          return (
            `<div style="margin-bottom:6px;font-weight:600">${arr[0].axisValue}</div>` +
            `${dot(c.green)}Медиана <b>${humanizeSeconds(p.p50Seconds)}</b><br/>` +
            `${dot(c.amber)}p90 <b>${humanizeSeconds(p.p90Seconds)}</b><br/>` +
            `${dot(c.violet)}Среднее ${humanizeSeconds(p.avgSeconds)}<br/>` +
            `<span style="opacity:.65">Ответов: ${p.responses}</span>`
          );
        },
      },
      legend: { data: ["Медиана", "p90", "Среднее"], ...legendTop },
      grid: { left: 16, right: 16, top: gridTop, bottom: 52, containLabel: true },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 8 }],
      xAxis: { type: "category", data: labels, boundaryGap: false, axisLabel: { hideOverlap: true } },
      yAxis: { type: "value", ...unit("мин"), axisLabel: { formatter: (v: number) => String(Math.round(v)) } },
      series: [
        ...spreadBand(p50, p90, c.amber),
        line("Медиана", c.green, p50, { z: 3, lineStyle: { width: 2.6, color: c.green } }),
        line("p90", c.amber, p90, { z: 2, lineStyle: { width: 1.8, color: c.amber } }),
        line("Среднее", c.violet, sla.map((p) => +(p.avgSeconds / 60).toFixed(1)), {
          z: 2,
          lineStyle: { width: 1.6, type: "dashed", color: c.violet },
        }),
      ],
    };
  }, [sla, labelFormat, c, unit, gridTop]);

  const resolutionOption = useMemo<EChartsOption>(() => {
    const labels = resolution.map((p) => dayjs(p.bucket).format(labelFormat));
    const p50 = resolution.map((p) => +(p.p50Seconds / 3600).toFixed(1));
    const p90 = resolution.map((p) => +(p.p90Seconds / 3600).toFixed(1));
    return {
      tooltip: {
        trigger: "axis",
        formatter: (params) => {
          const arr = params as unknown as Array<{ axisValue: string; dataIndex: number }>;
          const p = resolution[arr[0].dataIndex];
          return (
            `<div style="margin-bottom:6px;font-weight:600">${arr[0].axisValue}</div>` +
            `${dot(c.green)}Медиана <b>${humanizeSeconds(p.p50Seconds)}</b><br/>` +
            `${dot(c.amber)}p90 <b>${humanizeSeconds(p.p90Seconds)}</b><br/>` +
            `${dot(c.violet)}Среднее ${humanizeSeconds(p.avgSeconds)}<br/>` +
            `<span style="opacity:.65">Решено: ${p.resolved}</span>`
          );
        },
      },
      legend: { data: ["Медиана", "p90", "Среднее"], ...legendTop },
      grid: { left: 16, right: 16, top: gridTop, bottom: 52, containLabel: true },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 8 }],
      xAxis: { type: "category", data: labels, boundaryGap: false, axisLabel: { hideOverlap: true } },
      yAxis: { type: "value", ...unit("раб. ч"), axisLabel: { formatter: (v: number) => String(Math.round(v)) } },
      series: [
        ...spreadBand(p50, p90, c.amber),
        line("Медиана", c.green, p50, { z: 3, lineStyle: { width: 2.6, color: c.green } }),
        line("p90", c.amber, p90, { z: 2, lineStyle: { width: 1.8, color: c.amber } }),
        line("Среднее", c.violet, resolution.map((p) => +(p.avgSeconds / 3600).toFixed(1)), {
          z: 2,
          lineStyle: { width: 1.6, type: "dashed", color: c.violet },
        }),
      ],
    };
  }, [resolution, labelFormat, c, unit, gridTop]);

  const reopenTotals = useMemo(() => {
    const closed = reopens.reduce((n, p) => n + p.closed, 0);
    const probable = reopens.reduce((n, p) => n + p.probable, 0);
    const confirmed = reopens.reduce((n, p) => n + p.confirmed, 0);
    const rate = closed > 0 ? Math.round((probable / closed) * 1000) / 10 : 0;
    return { closed, probable, confirmed, rate };
  }, [reopens]);

  const reopensOption = useMemo<EChartsOption>(() => {
    const labels = reopens.map((p) => dayjs(p.bucket).format(labelFormat));
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { data: ["Вероятные", "Подтверждённые", "% от закрытых"], ...legendTop },
      grid: { left: 16, right: 16, top: gridTop, bottom: 52, containLabel: true },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 8 }],
      xAxis: { type: "category", data: labels, axisLabel: { hideOverlap: true } },
      yAxis: [
        { type: "value", ...unit("повторы") },
        { type: "value", ...unit("%"), position: "right", splitLine: { show: false } },
      ],
      series: [
        {
          name: "Вероятные",
          type: "bar",
          barMaxWidth: 26,
          itemStyle: { color: tint(c.blue, 0.35), borderRadius: [5, 5, 0, 0] },
          data: reopens.map((p) => p.probable),
        },
        {
          name: "Подтверждённые",
          type: "bar",
          barGap: "-100%",
          barMaxWidth: 26,
          itemStyle: { color: barFade(c.blue), borderRadius: [5, 5, 0, 0] },
          data: reopens.map((p) => p.confirmed),
        },
        line(
          "% от закрытых",
          c.amber,
          reopens.map((p) => (p.closed > 0 ? +((p.probable / p.closed) * 100).toFixed(1) : 0)),
          { yAxisIndex: 1, z: 3 },
        ),
      ],
    };
  }, [reopens, labelFormat, c, unit, gridTop]);

  // Number of times each weekday (0=Mon..6=Sun) occurs in the selected range,
  // used to turn cell sums into per-occurrence averages.
  const weekdayCounts = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    let cur = start.startOf("day");
    const last = end.startOf("day");
    while (!cur.isAfter(last)) {
      counts[(cur.day() + 6) % 7]++;
      cur = cur.add(1, "day");
    }
    return counts;
  }, [start, end]);

  const heatmapOption = useMemo<EChartsOption>(() => {
    const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
    const avg = heatmapMode === "avg";
    // A cell is one weekday-hour, so the average divides by how many times that
    // weekday fell in the period. Messages are whole things: a fractional count
    // is not a quantity anyone can act on, so it is rounded away.
    const value = (cell: { weekday: number; messages: number }) =>
      avg ? Math.round(cell.messages / Math.max(1, weekdayCounts[cell.weekday])) : cell.messages;
    const unit = avg ? "сообщ. в среднем" : "сообщ.";
    const max = heatmap.reduce((m, cell) => Math.max(m, value(cell)), 0);
    const cells = heatmap.map((cell) => [cell.hour, cell.weekday, value(cell)]);
    return {
      tooltip: {
        position: "top",
        formatter: (p) => {
          const v = (p as { value: number[] }).value;
          return `<b>${weekdays[v[1]]}, ${hours[v[0]]}:00</b><br/>${v[2]} ${unit}`;
        },
      },
      grid: { left: 4, right: 8, top: 8, bottom: 56, containLabel: true },
      xAxis: {
        type: "category",
        data: hours,
        axisLine: { show: false },
        axisLabel: { interval: 1 },
      },
      yAxis: { type: "category", data: weekdays, inverse: true },
      visualMap: {
        min: 0,
        max: max || 1,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 4,
        itemWidth: 12,
        itemHeight: 130,
      },
      series: [
        {
          type: "heatmap",
          data: cells,
          progressive: 0,
          itemStyle: { borderRadius: 3, borderWidth: 2, borderColor: c.surface },
          emphasis: { itemStyle: { borderColor: c.text, borderWidth: 1.5, borderRadius: 3 } },
        },
      ],
    };
  }, [heatmap, heatmapMode, weekdayCounts, c]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card styles={{ body: { padding: "14px 18px" } }}>
        <Space wrap size={16} style={{ width: "100%", justifyContent: "space-between" }}>
          <Space wrap size={12}>
            <RangePicker
              value={[start, end]}
              onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
              allowClear={false}
            />
            <Select
              showSearch
              style={{ width: 220 }}
              value={group ?? ""}
              onChange={(v) => setGroup(v || null)}
              options={[
                { value: "", label: "Все группы" },
                ...groups.map((g) => ({ value: g.groupName, label: g.groupName })),
              ]}
            />
          </Space>
          <Space wrap size={12}>
            <Segmented
              value={bucket}
              onChange={(v) => setBucket(v as Bucket)}
              options={[
                { label: "День", value: "day" },
                { label: "Неделя", value: "week" },
                { label: "Месяц", value: "month" },
              ]}
            />
          </Space>
        </Space>
      </Card>

      <QueryError error={firstError} style={{ marginBottom: 0 }} />

      {alertsReport && alertsReport.alerts.length > 0 && (
        <Card
          title="Аномалии"
          extra={
            alertsReport.asOf ? (
              <span className="meta">
                {dayjs(alertsReport.weekStart).format("DD MMM")} -{" "}
                {dayjs(alertsReport.asOf).format("DD MMM YYYY")}
              </span>
            ) : null
          }
        >
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            {alertsReport.alerts.map((a, i) => {
              const spike = a.type === "message_spike";
              return (
                <div
                  key={i}
                  className="anomaly"
                  style={{ "--anomaly-accent": spike ? c.amber : c.rose } as CSSProperties}
                >
                  <Tag color={spike ? "volcano" : "red"} style={{ marginInlineEnd: 0 }}>
                    {spike ? "всплеск" : "SLA"}
                  </Tag>
                  {spike ? (
                    <span>
                      <b>{a.groupName}</b>: {num(Math.round(a.current))} сообщений за неделю против{" "}
                      {num(Math.round(a.baseline))} обычных, ×{a.ratio}
                    </span>
                  ) : (
                    <span>
                      <b>{a.groupName}</b>: первый ответ {humanizeSeconds(a.current)} против{" "}
                      {humanizeSeconds(a.baseline)}, ×{a.ratio}
                    </span>
                  )}
                </div>
              );
            })}
          </Space>
        </Card>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <StatCard
            label="Сообщений"
            value={num(totals.messages)}
            hint={perBucket > 0 ? `${num(perBucket)} в среднем за ${BUCKET_NOUN[bucket]}` : null}
            icon={<MessageOutlined />}
            accent={c.blue}
            soft={tint(c.blue, 0.14)}
          />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard
            label="Закрыто заявок"
            value={num(totals.closed)}
            icon={<CheckCircleOutlined />}
            accent={c.green}
            soft={tint(c.green, 0.14)}
          />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard
            label="Отклонено"
            value={num(totals.rejected)}
            icon={<StopOutlined />}
            accent={c.rose}
            soft={tint(c.rose, 0.14)}
          />
        </Col>
        <Col xs={12} lg={6}>
          <Tooltip title="Не закрыты и не заброшены на конец периода. Открыть список">
            <div>
              <StatCard
                label="Открытых заявок"
                value={num(backlog?.openTickets ?? 0)}
                hint={
                  backlog?.asOf
                    ? `на ${dayjs(backlog.asOf).format("DD.MM.YYYY")}${backlogClamped ? ", конец данных" : ""}` +
                      (backlogOlder > 0 ? ` · старше недели: ${num(backlogOlder)}` : "")
                    : null
                }
                icon={<InboxOutlined />}
                accent={c.amber}
                soft={tint(c.amber, 0.14)}
                onClick={() => setOpenTicketsShown(true)}
              />
            </div>
          </Tooltip>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={12} md={8} xl={4}>
          <StatCard
            label="Без ответа"
            value={summary ? `${pct(summary.unanswered, summary.opened - summary.stillOpen) ?? 0}%` : "-"}
            hint={summary ? `${num(summary.unanswered)} заявок без единого ответа` : null}
            icon={<QuestionCircleOutlined />}
            accent={c.rose}
            soft={tint(c.rose, 0.14)}
          />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <StatCard
            label="Истекли по тишине"
            value={summary ? `${pct(summary.expired, summary.opened) ?? 0}%` : "-"}
            hint={summary ? `${num(summary.expired)} без фразы закрытия` : null}
            icon={<HourglassOutlined />}
            accent={c.amber}
            soft={tint(c.amber, 0.14)}
          />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <StatCard
            label="Ответ за 15 мин"
            value={summary ? `${pct(summary.answeredFast, summary.answered) ?? 0}%` : "-"}
            hint={summary ? `за час ${pct(summary.answeredHour, summary.answered) ?? 0}%` : null}
            icon={<ThunderboltOutlined />}
            accent={c.green}
            soft={tint(c.green, 0.14)}
          />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <StatCard
            label="Решено за час"
            value={summary ? `${pct(summary.resolvedHour, summary.resolved) ?? 0}%` : "-"}
            hint={summary ? `за рабочий день ${pct(summary.resolvedDay, summary.resolved) ?? 0}%` : null}
            icon={<FieldTimeOutlined />}
            accent={c.blue}
            soft={tint(c.blue, 0.14)}
          />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <StatCard
            label="Благодарностей"
            value={summary ? `${pct(summary.thanked, summary.closed) ?? 0}%` : "-"}
            hint={summary ? `${num(summary.thanked)} закрытий со «спасибо»` : null}
            icon={<LikeOutlined />}
            accent={c.violet}
            soft={tint(c.violet, 0.14)}
          />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <StatCard
            label="Вне рабочего времени"
            value={summary ? `${pct(summary.offHours, summary.incoming) ?? 0}%` : "-"}
            hint={summary ? `${num(summary.offHours)} входящих ночью и в выходные` : null}
            icon={<MoonOutlined />}
            accent={c.cyan}
            soft={tint(c.cyan, 0.14)}
          />
        </Col>
      </Row>

      <Card title="Динамика">
        {data.length === 0 && !isFetching ? (
          <Empty description="Нет данных за период" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <EChart option={option} loading={isFetching} height={400} />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <Card
            title="Заявки за период"
            style={{ height: "100%" }}
            extra={summary ? <span className="meta">открыто <b>{num(summary.opened)}</b></span> : null}
          >
            {!summary || summary.opened === 0 ? (
              <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <>
                <EChart option={outcomesOption} height={80} />
                <div className="facts">
                  <div>
                    <span className="meta">Клиентов</span>
                    <b>{num(summary.clients)}</b>
                    <span className="meta">новых {num(summary.newClients)}</span>
                  </div>
                  <div>
                    <span className="meta">Сообщений на заявку</span>
                    <b>{summary.p50Messages != null ? Math.round(summary.p50Messages) : "-"}</b>
                    <span className="meta">
                      медиана · p90 {summary.p90Messages != null ? Math.round(summary.p90Messages) : "-"}
                    </span>
                  </div>
                  <div>
                    <span className="meta">Ответ после первого</span>
                    <b>{summary.replies > 0 ? humanizeSeconds(summary.replySeconds / summary.replies) : "-"}</b>
                    <span className="meta">в среднем, {num(summary.replies)} ответов</span>
                  </div>
                  <div>
                    <span className="meta">Взято в работу</span>
                    <b>{num(summary.inProgress)}</b>
                    <span className="meta">
                      {summary.avgPickupSeconds != null
                        ? `через ${humanizeSeconds(summary.avgPickupSeconds)} в среднем`
                        : "фраза «в работе» не писалась"}
                    </span>
                  </div>
                  <div>
                    <span className="meta">Передач между участками</span>
                    <b>{num(summary.handoffs)}</b>
                    <span className="meta">{pct(summary.handoffs, summary.opened) ?? 0}% заявок</span>
                  </div>
                </div>
              </>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={14}>
          <Card title="Частые обращения" style={{ height: "100%" }} extra={<span className="meta">по числу заявок</span>}>
            <Table
              rowKey="client"
              columns={clientColumns}
              dataSource={topClients}
              loading={clientsLoading}
              size="small"
              pagination={false}
              scroll={{ x: true, y: 300 }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card
            title="Первый ответ"
            style={{ height: "100%" }}
            extra={
              overallFrt != null ? (
                <span
                  className="meta"
                  title="Средневзвешенная медиан по интервалам графика, не общая медиана периода"
                >
                  медиана <b>{humanizeSeconds(overallFrt.median)}</b> · среднее{" "}
                  {humanizeSeconds(overallFrt.mean)}
                </span>
              ) : null
            }
          >
            {sla.length === 0 && !slaLoading ? (
              <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <EChart option={slaOption} loading={slaLoading} height={300} />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card
            title="Время решения"
            style={{ height: "100%" }}
            extra={<span className="meta">рабочее время до закрытия</span>}
          >
            {resolution.length === 0 && !resolutionLoading ? (
              <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <EChart option={resolutionOption} loading={resolutionLoading} height={300} />
            )}
          </Card>
        </Col>
      </Row>

      <Card
        title="Повторные обращения"
        extra={
          <span className="meta">
            <b>{num(reopenTotals.probable)}</b> вероятных, {reopenTotals.rate}% от закрытых ·{" "}
            {num(reopenTotals.confirmed)} подтверждено
          </span>
        }
      >
        {reopens.length === 0 && !reopensLoading ? (
          <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <EChart option={reopensOption} loading={reopensLoading} height={300} />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card
            title="Нагрузка по часам"
            style={{ height: "100%" }}
            extra={
              <Segmented
                size="small"
                value={heatmapMode}
                onChange={(v) => setHeatmapMode(v as "sum" | "avg")}
                options={[
                  { label: "Сумма", value: "sum" },
                  { label: "В среднем", value: "avg" },
                ]}
              />
            }
          >
            {heatmap.length === 0 && !heatmapLoading ? (
              <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <EChart option={heatmapOption} loading={heatmapLoading} height={320} />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card
            title="Категории"
            style={{ height: "100%" }}
            extra={
              <span className="meta">
                классифицировано <b>{categoryStats.classifiedPct}%</b>
              </span>
            }
          >
            <Segmented
              size="small"
              block
              value={categoryMode}
              onChange={(v) => setCategoryMode(v as CategoryMode)}
              options={[
                { label: "Заявки", value: "requests" },
                { label: "Первый ответ", value: "frt" },
                { label: "Решение", value: "resolution" },
                { label: "Сообщений", value: "messages" },
                { label: "Повторы", value: "reopens" },
              ]}
              style={{ marginBottom: 8 }}
            />
            <div className="meta" style={{ marginBottom: 4 }}>
              {CATEGORY_UNIT[categoryMode]}
            </div>
            {categoryStats.named.length === 0 && !categoriesLoading ? (
              <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <EChart option={categoriesOption} loading={categoriesLoading} height={280} />
            )}
          </Card>
        </Col>
      </Row>

      <Card title="Категории во времени" extra={<span className="meta">по дате открытия заявки</span>}>
        {categoryTrend.length === 0 && !categoryTrendLoading ? (
          <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <EChart option={categoryTrendOption} loading={categoryTrendLoading} height={300} />
        )}
      </Card>

      <Modal
        title={`Открытые заявки на ${dayjs(backlog?.asOf ?? endStr).format("DD.MM.YYYY")}`}
        open={openTicketsShown}
        onCancel={() => setOpenTicketsShown(false)}
        width={1100}
        footer={
          <Space>
            <Button
              icon={<FileExcelOutlined />}
              disabled={openTickets.length === 0}
              onClick={() =>
                exportToExcel(
                  openTickets.map((t) => ({
                    Клиент: t.client,
                    Группа: t.groupNames ?? "",
                    Открыта: dayjs(t.openedAt).format("DD.MM.YYYY HH:mm"),
                    "Последнее сообщение": dayjs(t.lastActivity).format("DD.MM.YYYY HH:mm"),
                    Категория: t.category,
                    "Сообщений клиента": t.messagesIn,
                    "Сообщений поддержки": t.messagesOut,
                    "Первым ответил": t.firstResponder ?? "",
                    "Что дальше": t.finalStatus,
                    "Закрыта позже": t.closedAt ? dayjs(t.closedAt).format("DD.MM.YYYY HH:mm") : "",
                  })),
                  `open_tickets_${group ?? "all"}_${dayjs(backlog?.asOf ?? endStr).format("YYYY-MM-DD")}.xlsx`,
                  "Открытые заявки",
                )
              }
            >
              Excel
            </Button>
            <Button onClick={() => setOpenTicketsShown(false)}>Закрыть</Button>
          </Space>
        }
      >
        <p className="meta" style={{ marginTop: 0 }}>
          Имя клиента открывает его переписку в новой вкладке, начиная с даты открытия заявки.
        </p>
        {backlog && backlog.openTickets > 0 && (
          <p className="meta" style={{ marginTop: 0 }}>
            Возраст: до 1 дня <b>{num(backlog.ageDay)}</b> · 2-3 дня <b>{num(backlog.ageThreeDays)}</b> · 4-7 дней{" "}
            <b>{num(backlog.ageWeek)}</b> · 8-30 дней <b>{num(backlog.ageMonth)}</b> · больше месяца{" "}
            <b>{num(backlog.ageOlder)}</b>
            {backlog.oldestOpenedAt ? ` · самая старая с ${dayjs(backlog.oldestOpenedAt).format("DD.MM.YYYY")}` : ""}
          </p>
        )}
        <Table
          rowKey={(t) => `${t.client}_${t.openedAt}`}
          columns={openTicketColumns}
          dataSource={openTickets}
          loading={openTicketsLoading}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: true }}
        />
      </Modal>
    </Space>
  );
}
