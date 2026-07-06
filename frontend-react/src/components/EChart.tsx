import type { EChartsOption } from "echarts";
import * as echarts from "echarts";
import { useEffect, useRef } from "react";
import { useThemeMode } from "../theme";

interface Props {
  option: EChartsOption;
  height?: number | string;
  loading?: boolean;
}

/**
 * Thin React wrapper around an ECharts instance (init / update / resize /
 * dispose). Follows the app light/dark mode: switching the mode re-creates
 * the chart with the matching ECharts theme.
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

  // The built-in "dark" theme paints its own dark canvas; keep it transparent
  // so the chart sits on the antd Card background.
  const applyOption = (chart: echarts.ECharts, opt: EChartsOption) =>
    // `true` clears stale series when the shape of the option changes.
    chart.setOption({ backgroundColor: "transparent", ...opt }, true);

  useEffect(() => {
    if (!elementRef.current) return;
    const chart = echarts.init(elementRef.current, mode === "dark" ? "dark" : undefined);
    chartRef.current = chart;
    applyOption(chart, optionRef.current);
    if (loadingRef.current) chart.showLoading();
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, [mode]);

  useEffect(() => {
    if (chartRef.current) applyOption(chartRef.current, option);
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (loading) chart.showLoading();
    else chart.hideLoading();
  }, [loading]);

  return <div ref={elementRef} style={{ width: "100%", height }} />;
}
