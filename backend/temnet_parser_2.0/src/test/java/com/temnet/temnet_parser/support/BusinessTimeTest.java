package com.temnet.temnet_parser.support;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Working week used below: Mon 2026-07-06 .. Sun 2026-07-12,
 * business hours 08:00-18:00 (10h day).
 */
class BusinessTimeTest {

    private static LocalDateTime at(int day, int hour, int minute) {
        return LocalDateTime.of(2026, 7, day, hour, minute);
    }

    @Test
    void sameDayInsideWorkingHours() {
        assertThat(BusinessTime.secondsBetween(at(6, 9, 0), at(6, 11, 30)))
                .isEqualTo(2 * 3600 + 1800);
    }

    @Test
    void clampsStartBeforeWorkingHours() {
        assertThat(BusinessTime.secondsBetween(at(6, 6, 0), at(6, 9, 0)))
                .isEqualTo(3600);
    }

    @Test
    void clampsEndAfterWorkingHours() {
        assertThat(BusinessTime.secondsBetween(at(6, 17, 0), at(6, 20, 0)))
                .isEqualTo(3600);
    }

    @Test
    void overnightSpansTwoWorkingDays() {
        // Mon 17:00 -> Tue 09:00: 1h Monday + 1h Tuesday
        assertThat(BusinessTime.secondsBetween(at(6, 17, 0), at(7, 9, 0)))
                .isEqualTo(7200);
    }

    @Test
    void weekendContributesNothing() {
        // Fri 17:00 -> next Mon 09:00: 1h Friday + 1h Monday
        assertThat(BusinessTime.secondsBetween(at(10, 17, 0), at(13, 9, 0)))
                .isEqualTo(7200);
    }

    @Test
    void intervalEntirelyOnWeekendIsZero() {
        assertThat(BusinessTime.secondsBetween(at(11, 10, 0), at(12, 12, 0)))
                .isZero();
    }

    @Test
    void fullWeekIsFiveWorkingDays() {
        assertThat(BusinessTime.secondsBetween(at(6, 8, 0), at(13, 8, 0)))
                .isEqualTo(5 * 10 * 3600);
    }

    @Test
    void nullOrReversedArgumentsGiveZero() {
        assertThat(BusinessTime.secondsBetween(null, at(6, 9, 0))).isZero();
        assertThat(BusinessTime.secondsBetween(at(6, 9, 0), null)).isZero();
        assertThat(BusinessTime.secondsBetween(at(6, 11, 0), at(6, 9, 0))).isZero();
        assertThat(BusinessTime.secondsBetween(at(6, 9, 0), at(6, 9, 0))).isZero();
    }
}
