import type { EChartsOption } from "echarts";
import * as echarts from "echarts";
import { useEffect, useRef } from "react";
import { chartColors, CHART_THEME, registerChartThemes } from "../lib/chartTheme";
import { tokens } from "../lib/palette";
import { useThemeMode } from "../theme";

registerChartThemes();

interface Props {
  option: EChartsOption;
  height?: number | string;
  loading?: boolean;
}

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Thin React wrapper around an ECharts instance (init / update / resize /
 * dispose). Follows the app light/dark mode: switching the mode re-creates
 * the chart with the matching registered theme (see lib/chartTheme.ts).
 */
export default function EChart({ option, height = 380, loading = false }: Props) {
  const elementRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const { mode } = useThemeMode();

  // Latest props for the re-init effect, so it can restore state without
  // listing them as dependencies (that would re-create the chart on every
  // option change).
  const optionRef = useRef(option);
  optionRef.current = option;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const showLoading = (chart: echarts.ECharts) =>
    chart.showLoading("default", {
      text: "",
      color: chartColors(mode).blue,
      maskColor: "transparent",
      spinnerRadius: 12,
      lineWidth: 2,
      zlevel: 10,
    });

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const chart = echarts.init(element, CHART_THEME[mode], { renderer: "canvas" });
    chartRef.current = chart;
    // `true` clears stale series when the shape of the option changes.
    chart.setOption(
      { backgroundColor: "transparent", animation: !prefersReducedMotion(), ...optionRef.current },
      true,
    );
    if (loadingRef.current) showLoading(chart);

    // The sider collapses and cards reflow without a window resize event,
    // so the element itself is what gets watched.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => chart.resize());
    });
    observer.observe(element);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    chartRef.current?.setOption(
      { backgroundColor: "transparent", animation: !prefersReducedMotion(), ...option },
      true,
    );
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (loading) showLoading(chart);
    else chart.hideLoading();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  return (
    <div
      ref={elementRef}
      style={{ width: "100%", height, color: tokens[mode].text }}
      role="img"
    />
  );
}
