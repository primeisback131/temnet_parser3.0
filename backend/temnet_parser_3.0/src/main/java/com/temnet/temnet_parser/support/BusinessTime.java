package com.temnet.temnet_parser.support;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;

/**
 * Working-time arithmetic: seconds between two instants counting only
 * Monday–Friday, 08:00–18:00. Java port of the {@code business_seconds}
 * stored function (db/functions.sql) — the two MUST stay in sync.
 */
public final class BusinessTime {

    private static final int WORK_START = 8 * 3600;
    private static final int WORK_END = 18 * 3600;
    private static final int DAY_LEN = WORK_END - WORK_START; // 10h working day

    /** Reference Monday; all real data is after it. */
    private static final LocalDate REF = LocalDate.of(2000, 1, 3);

    private BusinessTime() {
    }

    public static long secondsBetween(LocalDateTime a, LocalDateTime b) {
        if (a == null || b == null || !b.isAfter(a)) {
            return 0;
        }
        return toBusinessSeconds(b) - toBusinessSeconds(a);
    }

    /** Business seconds from the reference Monday to {@code t}. */
    private static long toBusinessSeconds(LocalDateTime t) {
        long days = ChronoUnit.DAYS.between(REF, t.toLocalDate());
        long fullDays = (days / 7) * 5 * DAY_LEN + Math.min(days % 7, 5) * DAY_LEN;
        boolean weekend = t.getDayOfWeek().getValue() >= 6; // 6=Sat, 7=Sun
        long inDay = weekend
                ? 0
                : Math.max(0, Math.min(WORK_END, Math.max(WORK_START, t.toLocalTime().toSecondOfDay())) - WORK_START);
        return fullDays + inDay;
    }
}
