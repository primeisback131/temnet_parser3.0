import type { Dayjs } from "dayjs";
import dayjs from "dayjs";

/** Format a Dayjs value as the `yyyy-MM-dd` string the backend expects. */
export function toApiDate(d: Dayjs): string {
  return d.format("YYYY-MM-DD");
}

/** Default reporting range: Jan 1 of the current year → today. */
export function defaultRange(): [Dayjs, Dayjs] {
  return [dayjs().startOf("year"), dayjs()];
}
