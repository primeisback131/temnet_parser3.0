package com.temnet.temnet_parser.dto;

import java.time.LocalDate;

/**
 * Ticket resolution-time stats for one time bucket (bucketed by closing date).
 * {@code resolved} — number of tickets closed within the cap; the seconds are
 * business-hours time from the ticket's opening client message to its closure.
 */
public record ResolutionPoint(
        LocalDate bucket,
        Long resolved,
        Double avgSeconds,
        Double p50Seconds,
        Double p90Seconds
) {
}
