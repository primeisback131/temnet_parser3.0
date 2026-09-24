/** Seconds to a compact human string, e.g. "8 мин 20 с" or "1 ч 05 мин". */
export function humanizeSeconds(seconds: number | null | undefined): string {
  if (seconds == null) return "-";
  const s = Math.round(seconds);
  if (s < 60) return `${s} с`;
  if (s < 3600) return `${Math.floor(s / 60)} мин ${String(s % 60).padStart(2, "0")} с`;
  return `${Math.floor(s / 3600)} ч ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} мин`;
}

/**
 * Account names order by the number inside them: u1, u2, u10 - not u1, u10, u2.
 * Plain localeCompare goes character by character, so "." sorted before "6"
 * and g1, g16, g2 came out in that order on the users page.
 */
export function compareAccountNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}
