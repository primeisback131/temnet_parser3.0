import * as echarts from "echarts";
import { accent, tokens, type ThemeMode } from "./palette";

export const CHART_THEME: Record<ThemeMode, string> = {
  light: "temnet-light",
  dark: "temnet-dark",
};

/** The accent set a chart draws from, already resolved for the mode. */
export function chartColors(mode: ThemeMode) {
  return {
    blue: accent.blue[mode],
    green: accent.green[mode],
    amber: accent.amber[mode],
    rose: accent.rose[mode],
    violet: accent.violet[mode],
    cyan: accent.cyan[mode],
    text: tokens[mode].text,
    muted: tokens[mode]["text-muted"],
    faint: tokens[mode]["text-faint"],
    surface: tokens[mode].surface,
    border: tokens[mode].border,
  };
}

/** Vertical fade used under line series, from `color` down to nothing. */
export function areaFade(color: string, top = 0.28) {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: echarts.color.modifyAlpha(color, top) },
    { offset: 1, color: echarts.color.modifyAlpha(color, 0) },
  ]);
}

/** Top-lit fill for vertical bars, so a column reads as a solid object. */
export function barFade(color: string) {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color },
    { offset: 1, color: echarts.color.modifyAlpha(color, 0.55) },
  ]);
}

/** Same idea for horizontal bars: light at the axis, full at the tip. */
export function barFadeX(color: string) {
  return new echarts.graphic.LinearGradient(0, 0, 1, 0, [
    { offset: 0, color: echarts.color.modifyAlpha(color, 0.45) },
    { offset: 1, color },
  ]);
}

/**
 * Legend placement shared by every chart. Centred on purpose: axis names sit
 * at the top corners, so a corner-anchored legend collides with them as soon
 * as it grows a series.
 */
export const legendTop = { top: 0, left: "center" as const };

/** Legend swatch for HTML tooltip bodies. */
export const dot = (color: string) =>
  `<span style="display:inline-block;width:8px;height:8px;border-radius:3px;` +
  `background:${color};margin-right:8px;vertical-align:1px"></span>`;

/** Heat ramp for the load matrix: quiet cells stay close to the surface. */
export function heatRamp(mode: ThemeMode): string[] {
  return mode === "dark"
    ? ["#151a26", "#1b3563", "#2a5cb8", "#4a86ff", "#8fb6ff"]
    : ["#f2f6fd", "#cfe0ff", "#8fb2f9", "#4d7ff0", "#1f4bc4"];
}

function build(mode: ThemeMode) {
  const t = tokens[mode];
  const c = chartColors(mode);
  const axisLine = mode === "dark" ? "#2b3341" : "#dbe2ec";
  const split = mode === "dark" ? "rgba(255,255,255,0.055)" : "rgba(15,23,42,0.07)";

  const axis = {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: c.faint, fontSize: 11, margin: 12 },
    splitLine: { show: true, lineStyle: { color: split, width: 1 } },
    // Lifts the axis name clear of the topmost tick label.
    nameTextStyle: { color: c.faint, fontSize: 11, padding: [0, 0, 8, 0] },
  };

  return {
    color: [c.blue, c.green, c.amber, c.rose, c.violet, c.cyan],
    backgroundColor: "transparent",
    textStyle: { color: c.muted, fontSize: 12 },
    animationDuration: 420,
    animationEasing: "cubicOut",

    categoryAxis: { ...axis, splitLine: { show: false }, axisLine: { show: true, lineStyle: { color: axisLine } } },
    valueAxis: axis,
    timeAxis: axis,
    logAxis: axis,

    line: { symbol: "circle", symbolSize: 7, smooth: true },
    bar: { itemStyle: { borderRadius: [4, 4, 0, 0] } },

    legend: {
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 18,
      textStyle: { color: c.muted, fontSize: 12 },
      inactiveColor: mode === "dark" ? "#3d4658" : "#c2cad6",
    },

    tooltip: {
      backgroundColor: mode === "dark" ? "rgba(23,27,36,0.96)" : "rgba(255,255,255,0.97)",
      borderColor: t.border,
      borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: c.text, fontSize: 12 },
      extraCssText: `border-radius:10px;box-shadow:${t["shadow-raised"]};backdrop-filter:blur(8px)`,
      axisPointer: {
        lineStyle: { color: axisLine, width: 1, type: "dashed" },
        crossStyle: { color: axisLine, width: 1, type: "dashed" },
        shadowStyle: { color: mode === "dark" ? "rgba(255,255,255,0.045)" : "rgba(15,23,42,0.05)" },
        label: { backgroundColor: mode === "dark" ? "#2b3341" : "#475569", color: "#fff" },
      },
    },

    dataZoom: {
      borderColor: "transparent",
      backgroundColor: mode === "dark" ? "rgba(255,255,255,0.03)" : "rgba(15,23,42,0.03)",
      fillerColor: echarts.color.modifyAlpha(c.blue, 0.14),
      handleStyle: { color: t.surface, borderColor: c.blue, borderWidth: 1.5 },
      moveHandleStyle: { color: echarts.color.modifyAlpha(c.blue, 0.35) },
      dataBackground: {
        lineStyle: { color: c.faint, opacity: 0.4 },
        areaStyle: { color: c.faint, opacity: 0.12 },
      },
      selectedDataBackground: {
        lineStyle: { color: c.blue },
        areaStyle: { color: c.blue, opacity: 0.18 },
      },
      textStyle: { color: c.faint, fontSize: 10 },
      emphasis: { handleStyle: { borderColor: c.blue } },
    },

    visualMap: {
      textStyle: { color: c.faint, fontSize: 11 },
      itemWidth: 12,
      inRange: { color: heatRamp(mode) },
    },
  };
}

let registered = false;

/** Registers both themes with ECharts once per page load. */
export function registerChartThemes() {
  if (registered) return;
  echarts.registerTheme(CHART_THEME.light, build("light"));
  echarts.registerTheme(CHART_THEME.dark, build("dark"));
  registered = true;
}
