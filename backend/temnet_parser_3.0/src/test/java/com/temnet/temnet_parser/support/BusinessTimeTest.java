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

    @Test
    void plusStaysInsideTheSameWorkingDay() {
        // Mon 09:00 + 2h -> Mon 11:00
        assertThat(BusinessTime.plusBusinessSeconds(at(6, 9, 0), 2 * 3600))
                .isEqualTo(at(6, 11, 0));
    }

    @Test
    void plusRollsOverToTheNextWorkingMorning() {
        // Mon 17:00 + 2h -> 1h left on Monday, then Tue 09:00
        assertThat(BusinessTime.plusBusinessSeconds(at(6, 17, 0), 2 * 3600))
                .isEqualTo(at(7, 9, 0));
    }

    @Test
    void plusSkipsTheWeekend() {
        // Fri 17:00 + 2h -> 1h left on Friday, then Mon 09:00
        assertThat(BusinessTime.plusBusinessSeconds(at(10, 17, 0), 2 * 3600))
                .isEqualTo(at(13, 9, 0));
    }

    @Test
    void plusFromNonWorkingTimeStartsAtTheNextWorkingMoment() {
        // Sat 12:00 and Mon 06:00 both clamp to Mon 08:00 as the start
        assertThat(BusinessTime.plusBusinessSeconds(at(11, 12, 0), 3600)).isEqualTo(at(13, 9, 0));
        assertThat(BusinessTime.plusBusinessSeconds(at(13, 6, 0), 3600)).isEqualTo(at(13, 9, 0));
    }

    @Test
    void plusTwentyWorkingHoursIsTwoWorkingDays() {
        // The ticket-expiry threshold: Mon 10:00 + 20 working hours -> Wed 10:00
        assertThat(BusinessTime.plusBusinessSeconds(at(6, 10, 0), 20 * 3600))
                .isEqualTo(at(8, 10, 0));
        // ...and across a weekend: Thu 10:00 -> Mon 10:00
        assertThat(BusinessTime.plusBusinessSeconds(at(9, 10, 0), 20 * 3600))
                .isEqualTo(at(13, 10, 0));
    }

    @Test
    void plusIsTheExactInverseOfSecondsBetween() {
        int[][] starts = {{6, 8, 0}, {6, 9, 30}, {6, 17, 59}, {8, 12, 0}, {10, 17, 0}, {11, 10, 0}, {13, 6, 0}};
        long[] offsets = {0, 1, 3600, 10 * 3600 - 1, 10 * 3600, 20 * 3600, 5 * 10 * 3600, 37 * 3600 + 42};
        for (int[] s : starts) {
            LocalDateTime from = at(s[0], s[1], s[2]);
            for (long offset : offsets) {
                LocalDateTime to = BusinessTime.plusBusinessSeconds(from, offset);
                assertThat(BusinessTime.secondsBetween(from, to))
                        .as("%s + %d working seconds -> %s", from, offset, to)
                        .isEqualTo(offset);
            }
        }
    }
}
