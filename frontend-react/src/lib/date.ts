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

/**
 * Split an inclusive date range into calendar-month chunks. The first and
 * last chunks may be partial months; the ones in between are whole months.
 */
export function monthlyRanges(start: Dayjs, end: Dayjs): [Dayjs, Dayjs][] {
  const ranges: [Dayjs, Dayjs][] = [];
  let cur = start.startOf("day");
  const last = end.startOf("day");
  while (!cur.isAfter(last)) {
    const monthEnd = cur.endOf("month").startOf("day");
    const chunkEnd = monthEnd.isBefore(last) ? monthEnd : last;
    ranges.push([cur, chunkEnd]);
    cur = chunkEnd.add(1, "day");
  }
  return ranges;
}
