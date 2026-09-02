/** Seconds to a compact human string, e.g. "8 мин 20 с" or "1 ч 05 мин". */
export function humanizeSeconds(seconds: number | null | undefined): string {
  if (seconds == null) return "-";
  const s = Math.round(seconds);
  if (s < 60) return `${s} с`;
  if (s < 3600) return `${Math.floor(s / 60)} мин ${String(s % 60).padStart(2, "0")} с`;
  return `${Math.floor(s / 3600)} ч ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} мин`;
}
