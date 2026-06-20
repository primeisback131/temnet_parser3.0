import { Card, Col, DatePicker, Row, Segmented, Select, Space, Statistic } from "antd";
import type { EChartsOption } from "echarts";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useGroups, useHeatmap, useSla, useTimeseries } from "../api/queries";
import type { Bucket } from "../api/types";
import EChart from "../components/EChart";
import { defaultRange, toApiDate } from "../lib/date";

const { RangePicker } = DatePicker;

/** Seconds → compact human string, e.g. "8 мин 20 с" or "1 ч 05 мин". */
function humanizeSeconds(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} с`;
  if (s < 3600) return `${Math.floor(s / 60)} мин ${String(s % 60).padStart(2, "0")} с`;
  return `${Math.floor(s / 3600)} ч ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} мин`;
}

const COLORS = {
  messages: "#3e79f7",
  closed: "#21b573",
  rejected: "#ff6b72",
  inProgress: "#ffa940",
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

  // Overall first-response time, weighted by the number of responses per bucket.
  const overallFrt = useMemo(() => {
    const totalResponses = sla.reduce((n, p) => n + p.responses, 0);
    if (totalResponses === 0) return null;
    const weighted = sla.reduce((n, p) => n + p.avgSeconds * p.responses, 0);
    return weighted / totalResponses;
  }, [sla]);

  const totals = useMemo(
    () =>
      data.reduce(
        (acc, p) => ({
          messages: acc.messages + p.messages,
          closed: acc.closed + p.closed,
          rejected: acc.rejected + p.rejected,
          inProgress: acc.inProgress + p.inProgress,
        }),
        { messages: 0, closed: 0, rejected: 0, inProgress: 0 },
      ),
    [data],
  );

  const labelFormat = bucket === "month" ? "MMM YYYY" : "DD MMM";

  const option = useMemo<EChartsOption>(() => {
    const labels = data.map((p) => dayjs(p.bucket).format(labelFormat));
    return {
      tooltip: { trigger: "axis" },
      legend: { data: ["Сообщения", "Закрытые", "Отклонённые", "В работе"], top: 0 },
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
          name: "В работе",
          type: "line",
          smooth: true,
          showSymbol: false,
          itemStyle: { color: COLORS.inProgress },
          data: data.map((p) => p.inProgress),
        },
      ],
    };
  }, [data, labelFormat]);

  const slaOption = useMemo<EChartsOption>(() => {
    const labels = sla.map((p) => dayjs(p.bucket).format(labelFormat));
    return {
      tooltip: {
        trigger: "axis",
        formatter: (params) => {
          const arr = params as unknown as Array<{ axisValue: string; dataIndex: number }>;
          const p = sla[arr[0].dataIndex];
          return `${arr[0].axisValue}<br/>Ср. ответ: <b>${humanizeSeconds(p.avgSeconds)}</b><br/>Ответов: ${p.responses}`;
        },
      },
      grid: { left: 56, right: 24, top: 24, bottom: 64 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 16 }],
      xAxis: { type: "category", data: labels, boundaryGap: false, axisLabel: { hideOverlap: true } },
      yAxis: {
        type: "value",
        name: "мин",
        axisLabel: { formatter: (v: number) => String(Math.round(v)) },
      },
      series: [
        {
          name: "Время первого ответа",
          type: "line",
          smooth: true,
          showSymbol: false,
          areaStyle: { opacity: 0.1 },
          itemStyle: { color: "#9254de" },
          data: sla.map((p) => +(p.avgSeconds / 60).toFixed(1)),
        },
      ],
    };
  }, [sla, labelFormat]);

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
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}><Card><Statistic title="Сообщений" value={totals.messages} valueStyle={{ color: COLORS.messages }} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Закрытых заявок" value={totals.closed} valueStyle={{ color: COLORS.closed }} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Отклонённых" value={totals.rejected} valueStyle={{ color: COLORS.rejected }} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="В работе" value={totals.inProgress} valueStyle={{ color: COLORS.inProgress }} /></Card></Col>
      </Row>

      <Card title={`Динамика — ${group ?? "все группы"}`}>
        <EChart option={option} loading={isFetching} height={420} />
      </Card>

      <Card
        title="Время первого ответа оператора"
        extra={
          overallFrt != null ? (
            <span>
              В среднем: <b style={{ color: "#9254de" }}>{humanizeSeconds(overallFrt)}</b>
            </span>
          ) : null
        }
      >
        <EChart option={slaOption} loading={slaLoading} height={300} />
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
    </Space>
  );
}
