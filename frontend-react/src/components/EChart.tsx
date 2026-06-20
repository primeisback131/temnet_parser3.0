import type { EChartsOption } from "echarts";
import * as echarts from "echarts";
import { useEffect, useRef } from "react";

interface Props {
  option: EChartsOption;
  height?: number | string;
  loading?: boolean;
}

/** Thin React wrapper around an ECharts instance (init / update / resize / dispose). */
export default function EChart({ option, height = 380, loading = false }: Props) {
  const elementRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!elementRef.current) return;
    const chart = echarts.init(elementRef.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    // `true` clears stale series when the shape of the option changes.
    chartRef.current?.setOption(option, true);
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (loading) chart.showLoading();
    else chart.hideLoading();
  }, [loading]);

  return <div ref={elementRef} style={{ width: "100%", height }} />;
}
