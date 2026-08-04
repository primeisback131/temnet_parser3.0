import { FileExcelOutlined } from "@ant-design/icons";
import { Button, Card, Col, DatePicker, Empty, Modal, Row, Segmented, Select, Space, Statistic, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { EChartsOption } from "echarts";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import {
  useAlerts,
  useBacklog,
  useBacklogTickets,
  useCategories,
  useGroups,
  useHeatmap,
  useReopens,
  useResolution,
  useSla,
  useTimeseries,
} from "../api/queries";
import type { Bucket, OpenTicket } from "../api/types";
import EChart from "../components/EChart";
import { defaultRange, toApiDate } from "../lib/date";
import { exportToExcel, exportWorkbook } from "../lib/excel";
import { humanizeSeconds } from "../lib/format";

const { RangePicker } = DatePicker;

const COLORS = {
  messages: "#3e79f7",
  closed: "#21b573",
  rejected: "#ff6b72",
  backlog: "#ffa940",
};

export default function MetricsPage() {
  const [[start, end], setRange] = useState(defaultRange);
  const [group, setGroup] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket>("day");
  const [heatmapMode, setHeatmapMode] = useState<"sum" | "avg">("sum");

  const startStr = toApiDate(start);
  const endStr = toApiDate(end);

  const { data: groups = [] } = useGroups();
  const { data = [], isFetching } = useTimeseries(startStr, endStr, bucket, group);
  const { data: heatmap = [], isFetching: heatmapLoading } = useHeatmap(startStr, endStr, group);
  const { data: sla = [], isFetching: slaLoading } = useSla(startStr, endStr, bucket, group);
  const { data: resolution = [], isFetching: resolutionLoading } = useResolution(startStr, endStr, bucket, group);
  const { data: reopens = [], isFetching: reopensLoading } = useReopens(startStr, endStr, bucket, group);
  const { data: alertsReport } = useAlerts();
  const { data: backlog } = useBacklog(endStr, group);
  // The period reaches past the data: the count describes the last day with
  // messages, not the requested end.
  const backlogClamped = backlog != null && dayjs(backlog.asOf).isBefore(dayjs(endStr), "day");
  const [openTicketsShown, setOpenTicketsShown] = useState(false);
  const { data: openTickets = [], isFetching: openTicketsLoading } = useBacklogTickets(
    endStr,
    group,
    openTicketsShown,
  );

  /** Deep link to the conversation of an open ticket, on the chat screen. */
  const chatLink = (t: OpenTicket) => {
    // A client can belong to several groups; the chat screen shows one at a time.
    const chatGroup = group ?? t.groupNames?.split(",")[0]?.trim() ?? "";
    const params = new URLSearchParams({
      group: chatGroup,
      user: t.client,
      start: dayjs(t.openedAt).format("YYYY-MM-DD"),
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
        <Link to={chatLink(t)} target="_blank">
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
  const { data: categories = [], isFetching: categoriesLoading } = useCategories(startStr, endStr, group);

  const categoryStats = useMemo(() => {
    const named = categories.filter((c) => c.category !== "Другое");
    const other = categories.find((c) => c.category === "Другое")?.requests ?? 0;
    const total = categories.reduce((n, c) => n + c.requests, 0);
    const classifiedPct = total > 0 ? Math.round(((total - other) / total) * 100) : 0;
    return { named, other, classifiedPct };
  }, [categories]);

  // Overall first-response time. Both values are weighted by responses per
  // bucket; the "median" is therefore a weighted average of per-bucket p50s
  // (a stable "typical SLA" proxy), not a true overall median — the label
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

  const labelFormat = bucket === "month" ? "MMM YYYY" : "DD MMM";

  const option = useMemo<EChartsOption>(() => {
    const labels = data.map((p) => dayjs(p.bucket).format(labelFormat));
    return {
      tooltip: { trigger: "axis" },
      legend: { data: ["Сообщения", "Закрытые", "Отклонённые", "Открытых на конец"], top: 0 },
      grid: { left: 56, right: 56, top: 40, bottom: 64 },
      dataZoom: [
        { type: "inside" },
        { type: "slider", height: 18, bottom: 16 },
      ],
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        axisLabel: { hideOverlap: true },
      },
      yAxis: [
        { type: "value", name: "Заявки" },
        { type: "value", name: "Сообщения", position: "right", splitLine: { show: false } },
      ],
      series: [
        {
          name: "Сообщения",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          showSymbol: false,
          areaStyle: { opacity: 0.12 },
          lineStyle: { width: 1 },
          itemStyle: { color: COLORS.messages },
          data: data.map((p) => p.messages),
        },
        {
          name: "Закрытые",
          type: "line",
          smooth: true,
          showSymbol: false,
          itemStyle: { color: COLORS.closed },
          data: data.map((p) => p.closed),
        },
        {
          name: "Отклонённые",
          type: "line",
          smooth: true,
          showSymbol: false,
          itemStyle: { color: COLORS.rejected },
          data: data.map((p) => p.rejected),
        },
        {
          name: "Открытых на конец",
          type: "line",
          smooth: true,
          showSymbol: false,
          itemStyle: { color: COLORS.backlog },
          data: data.map((p) => p.backlog),
        },
      ],
    };
  }, [data, labelFormat]);

  const categoriesOption = useMemo<EChartsOption>(() => {
    const named = categoryStats.named;
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 120, right: 48, top: 8, bottom: 24 },
      xAxis: { type: "value" },
      yAxis: { type: "category", data: named.map((c) => c.category), inverse: true },
      series: [
        {
          type: "bar",
          data: named.map((c) => c.requests),
          itemStyle: { color: "#3e79f7", borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: "right" },
        },
      ],
    };
  }, [categoryStats]);

  const slaOption = useMemo<EChartsOption>(() => {
    const labels = sla.map((p) => dayjs(p.bucket).format(labelFormat));
    return {
      tooltip: {
        trigger: "axis",
        formatter: (params) => {
          const arr = params as unknown as Array<{ axisValue: string; dataIndex: number }>;
          const p = sla[arr[0].dataIndex];
          return (
            `${arr[0].axisValue}<br/>` +
            `Медиана (p50): <b>${humanizeSeconds(p.p50Seconds)}</b><br/>` +
            `p90: <b>${humanizeSeconds(p.p90Seconds)}</b><br/>` +
            `Среднее: ${humanizeSeconds(p.avgSeconds)}<br/>` +
            `Ответов: ${p.responses}`
          );
        },
      },
      legend: { data: ["Медиана (p50)", "p90", "Среднее"], top: 0 },
      grid: { left: 56, right: 24, top: 40, bottom: 64 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 16 }],
      xAxis: { type: "category", data: labels, boundaryGap: false, axisLabel: { hideOverlap: true } },
      yAxis: {
        type: "value",
        name: "мин",
        axisLabel: { formatter: (v: number) => String(Math.round(v)) },
      },
      series: [
        {
          name: "Медиана (p50)",
          type: "line",
          smooth: true,
          showSymbol: false,
          itemStyle: { color: "#21b573" },
          data: sla.map((p) => +(p.p50Seconds / 60).toFixed(1)),
        },
        {
          name: "p90",
          type: "line",
          smooth: true,
          showSymbol: false,
          itemStyle: { color: "#ff7a45" },
          data: sla.map((p) => +(p.p90Seconds / 60).toFixed(1)),
        },
        {
          name: "Среднее",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { type: "dashed" },
          itemStyle: { color: "#9254de" },
          data: sla.map((p) => +(p.avgSeconds / 60).toFixed(1)),
        },
      ],
    };
  }, [sla, labelFormat]);

  const resolutionOption = useMemo<EChartsOption>(() => {
    const labels = resolution.map((p) => dayjs(p.bucket).format(labelFormat));
    return {
      tooltip: {
        trigger: "axis",
        formatter: (params) => {
          const arr = params as unknown as Array<{ axisValue: string; dataIndex: number }>;
          const p = resolution[arr[0].dataIndex];
          return (
            `${arr[0].axisValue}<br/>` +
            `Медиана (p50): <b>${humanizeSeconds(p.p50Seconds)}</b><br/>` +
            `p90: <b>${humanizeSeconds(p.p90Seconds)}</b><br/>` +
            `Среднее: ${humanizeSeconds(p.avgSeconds)}<br/>` +
            `Решено: ${p.resolved}`
          );
        },
      },
      legend: { data: ["Медиана (p50)", "p90", "Среднее"], top: 0 },
      grid: { left: 56, right: 24, top: 40, bottom: 64 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 16 }],
      xAxis: { type: "category", data: labels, boundaryGap: false, axisLabel: { hideOverlap: true } },
      yAxis: {
        type: "value",
        name: "раб. ч",
        axisLabel: { formatter: (v: number) => String(Math.round(v)) },
      },
      series: [
        {
          name: "Медиана (p50)",
          type: "line",
          smooth: true,
          showSymbol: false,
          itemStyle: { color: "#21b573" },
          data: resolution.map((p) => +(p.p50Seconds / 3600).toFixed(1)),
        },
        {
          name: "p90",
          type: "line",
          smooth: true,
          showSymbol: false,
          itemStyle: { color: "#ff7a45" },
          data: resolution.map((p) => +(p.p90Seconds / 3600).toFixed(1)),
        },
        {
          name: "Среднее",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { type: "dashed" },
          itemStyle: { color: "#9254de" },
          data: resolution.map((p) => +(p.avgSeconds / 3600).toFixed(1)),
        },
      ],
    };
  }, [resolution, labelFormat]);

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
      tooltip: { trigger: "axis" },
      legend: { data: ["Вероятные", "Подтверждённые", "% от закрытых"], top: 0 },
      grid: { left: 56, right: 56, top: 40, bottom: 64 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 16 }],
      xAxis: { type: "category", data: labels, axisLabel: { hideOverlap: true } },
      yAxis: [
        { type: "value", name: "Повторы" },
        { type: "value", name: "%", position: "right", splitLine: { show: false } },
      ],
      series: [
        {
          name: "Вероятные",
          type: "bar",
          itemStyle: { color: "#9cc0ff" },
          data: reopens.map((p) => p.probable),
        },
        {
          name: "Подтверждённые",
          type: "bar",
          barGap: "-100%",
          itemStyle: { color: "#3e79f7" },
          data: reopens.map((p) => p.confirmed),
        },
        {
          name: "% от закрытых",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          showSymbol: false,
          itemStyle: { color: "#ff7a45" },
          data: reopens.map((p) => (p.closed > 0 ? +((p.probable / p.closed) * 100).toFixed(1) : 0)),
        },
      ],
    };
  }, [reopens, labelFormat]);

  const exportReport = async () => {
    const [companies, operators] = await Promise.all([
      api.getCompanies(startStr, endStr),
      api.getOperators(startStr, endStr, group ?? undefined),
    ]);
    await exportWorkbook(
      [
        {
          name: "Сводка",
          rows: [
            { Показатель: "Период", Значение: `${startStr} — ${endStr}` },
            { Показатель: "Группа", Значение: group ?? "все" },
            { Показатель: "Сообщений", Значение: totals.messages },
            {
              Показатель: backlogClamped
                ? `Открытых заявок на ${dayjs(backlog!.asOf).format("DD.MM.YYYY")} (конец данных)`
                : "Открытых заявок на конец периода",
              Значение: backlog?.openTickets ?? 0,
            },
            { Показатель: "Закрытых заявок", Значение: totals.closed },
            { Показатель: "Отклонённых", Значение: totals.rejected },
            { Показатель: "Повторных обращений (вероятных)", Значение: reopenTotals.probable },
            { Показатель: "Повторных обращений, % от закрытых", Значение: reopenTotals.rate },
            {
              Показатель: "Первый ответ, медиана",
              Значение: overallFrt ? humanizeSeconds(overallFrt.median) : "—",
            },
          ],
        },
        {
          name: "Динамика",
          rows: data.map((p) => ({
            Период: p.bucket,
            Сообщений: p.messages,
            Закрыто: p.closed,
            Отклонено: p.rejected,
            "Открытых на конец": p.backlog,
          })),
        },
        {
          name: "Первый ответ",
          rows: sla.map((p) => ({
            Период: p.bucket,
            Ответов: p.responses,
            "Медиана, с": Math.round(p.p50Seconds),
            "p90, с": Math.round(p.p90Seconds),
            "Среднее, с": Math.round(p.avgSeconds),
          })),
        },
        {
          name: "Время решения",
          rows: resolution.map((p) => ({
            Период: p.bucket,
            Решено: p.resolved,
            "Медиана, мин": Math.round(p.p50Seconds / 60),
            "p90, ч": +(p.p90Seconds / 3600).toFixed(1),
            "Среднее, ч": +(p.avgSeconds / 3600).toFixed(1),
          })),
        },
        {
          name: "Повторы",
          rows: reopens.map((p) => ({
            Период: p.bucket,
            Закрыто: p.closed,
            Вероятные: p.probable,
            Подтверждённые: p.confirmed,
          })),
        },
        {
          name: "Категории",
          rows: categories.map((c) => ({ Категория: c.category, Обращений: c.requests })),
        },
        {
          name: "Операторы",
          rows: operators.map((o) => ({
            Оператор: o.operator,
            Закрыто: o.closed,
            Отклонено: o.rejected,
            Сообщений: o.messages,
            Клиентов: o.clients,
            "Ср. первый ответ, с": o.avgReplySeconds == null ? "" : Math.round(o.avgReplySeconds),
          })),
        },
        {
          name: "Компании",
          rows: companies.map((c) => ({
            Компания: c.groupName,
            "Активных пользователей": c.activeUsers,
            "Всего пользователей": c.totalUsers,
            Закрыто: c.closedRequests,
            Отклонено: c.rejectedRequests,
            Сообщений: c.totalMessages,
          })),
        },
      ],
      `Отчёт_${group ?? "все"}_${startStr}_${endStr}`,
    );
  };

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
    const value = (c: { weekday: number; messages: number }) =>
      avg ? +(c.messages / Math.max(1, weekdayCounts[c.weekday])).toFixed(1) : c.messages;
    const unit = avg ? "сообщ./день" : "сообщ.";
    const max = heatmap.reduce((m, c) => Math.max(m, value(c)), 0);
    const cells = heatmap.map((c) => [c.hour, c.weekday, value(c)]);
    return {
      tooltip: {
        position: "top",
        formatter: (p) => {
          const v = (p as { value: number[] }).value;
          return `${weekdays[v[1]]}, ${hours[v[0]]}:00 — ${v[2]} ${unit}`;
        },
      },
      grid: { left: 48, right: 16, top: 10, bottom: 60 },
      xAxis: { type: "category", data: hours, splitArea: { show: true } },
      yAxis: { type: "category", data: weekdays, splitArea: { show: true } },
      visualMap: {
        min: 0,
        max: max || 1,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 8,
        inRange: { color: ["#eef3ff", "#9cc0ff", "#3e79f7", "#1e3a8a"] },
      },
      series: [
        {
          type: "heatmap",
          data: cells,
          progressive: 0,
          emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.3)" } },
        },
      ],
    };
  }, [heatmap, heatmapMode, weekdayCounts]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card>
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
            <Tooltip title="Сводный отчёт за выбранный период: динамика, SLA, время решения, повторы, категории, операторы, компании">
              <Button icon={<FileExcelOutlined />} onClick={exportReport}>
                Отчёт
              </Button>
            </Tooltip>
          </Space>
        </Space>
      </Card>

      {alertsReport && alertsReport.alerts.length > 0 && (
        <Card
          title="Аномалии за последнюю неделю данных"
          extra={
            alertsReport.asOf ? (
              <span style={{ color: "#8c8c8c" }}>
                {dayjs(alertsReport.weekStart).format("DD MMM")} —{" "}
                {dayjs(alertsReport.asOf).format("DD MMM YYYY HH:mm")}
              </span>
            ) : null
          }
        >
          <Space direction="vertical" size={8}>
            {alertsReport.alerts.map((a, i) => (
              <div key={i}>
                {a.type === "message_spike" ? (
                  <>
                    <Tag color="volcano">Всплеск</Tag>
                    <b>{a.groupName}</b>: {Math.round(a.current)} сообщений за неделю против ~
                    {Math.round(a.baseline)}/нед (×{a.ratio})
                  </>
                ) : (
                  <>
                    <Tag color="red">SLA</Tag>
                    <b>{a.groupName}</b>: первый ответ {humanizeSeconds(a.current)} против{" "}
                    {humanizeSeconds(a.baseline)} (×{a.ratio})
                  </>
                )}
              </div>
            ))}
          </Space>
        </Card>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}><Card><Statistic title="Сообщений" value={totals.messages} valueStyle={{ color: COLORS.messages }} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Закрытых заявок" value={totals.closed} valueStyle={{ color: COLORS.closed }} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Отклонённых" value={totals.rejected} valueStyle={{ color: COLORS.rejected }} /></Card></Col>
        <Col xs={12} md={6}>
          <Card
            hoverable
            onClick={() => setOpenTicketsShown(true)}
            style={{ cursor: "pointer" }}
          >
            <Tooltip
              title={
                "Заявки, открытые на конец периода: не закрыты и не заброшены " +
                "(клиент молчит дольше 20 рабочих часов). Нажмите, чтобы увидеть список." +
                (backlogClamped ? " Период выходит за пределы данных — показано на дату последнего сообщения." : "")
              }
            >
              <Statistic
                title="Открытых на конец периода"
                value={backlog?.openTickets ?? 0}
                suffix={
                  backlogClamped ? (
                    <span style={{ fontSize: 13, color: "#8c8c8c", marginLeft: 8 }}>
                      на {dayjs(backlog!.asOf).format("DD.MM.YYYY")}
                    </span>
                  ) : undefined
                }
                valueStyle={{ color: COLORS.backlog }}
              />
            </Tooltip>
          </Card>
        </Col>
      </Row>

      <Card title={`Динамика — ${group ?? "все группы"}`}>
        <EChart option={option} loading={isFetching} height={420} />
      </Card>

      <Card
        title="Время первого ответа инженера"
        extra={
          overallFrt != null ? (
            <span title="Средневзвешенная медиан по интервалам графика (не общая медиана периода)">
              Медиана (взвеш.): <b style={{ color: "#21b573" }}>{humanizeSeconds(overallFrt.median)}</b>
              <span style={{ color: "#8c8c8c" }}> · среднее {humanizeSeconds(overallFrt.mean)}</span>
            </span>
          ) : null
        }
      >
        <EChart option={slaOption} loading={slaLoading} height={300} />
      </Card>

      <Card
        title="Время решения заявки"
        extra={<span style={{ color: "#8c8c8c" }}>от открытия до «закрыта заявка», рабочее время</span>}
      >
        <EChart option={resolutionOption} loading={resolutionLoading} height={300} />
      </Card>

      <Card
        title="Повторные обращения"
        extra={
          <span style={{ color: "#8c8c8c" }}>
            За период: <b>{reopenTotals.probable}</b> вероятных ({reopenTotals.rate}% от закрытых) ·{" "}
            {reopenTotals.confirmed} подтверждённых
          </span>
        }
      >
        {reopens.length === 0 && !reopensLoading ? (
          <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <EChart option={reopensOption} loading={reopensLoading} height={300} />
        )}
      </Card>

      <Card
        title="Нагрузка по часам и дням недели"
        extra={
          <Segmented
            value={heatmapMode}
            onChange={(v) => setHeatmapMode(v as "sum" | "avg")}
            options={[
              { label: "Сумма", value: "sum" },
              { label: "Среднее/день", value: "avg" },
            ]}
          />
        }
      >
        <EChart option={heatmapOption} loading={heatmapLoading} height={300} />
      </Card>

      <Card
        title="Категории обращений"
        extra={
          <span style={{ color: "#8c8c8c" }}>
            Классифицировано: <b>{categoryStats.classifiedPct}%</b> · Другое:{" "}
            {categoryStats.other.toLocaleString("ru-RU")}
          </span>
        }
      >
        <EChart option={categoriesOption} loading={categoriesLoading} height={340} />
      </Card>

      <Modal
        title={`Открытые заявки на ${dayjs(backlog?.asOf ?? endStr).format("DD.MM.YYYY")} — ${group ?? "все группы"}`}
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
        <p style={{ color: "#8c8c8c", marginTop: 0 }}>
          Клик по имени клиента открывает его переписку в разделе чатов (в новой вкладке),
          начиная с даты открытия заявки.
        </p>
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
