package com.temnet.temnet_parser.dto;

import java.time.LocalDate;

/**
 * Ticket resolution-time stats for one time bucket (by closing date).
 * All durations are WORKING seconds (08:00-18:00 Mon-Fri).
 */
public record ResolutionPoint(
        LocalDate bucket,
        Long resolved,
        Double avgSeconds,
        Double p50Seconds,
        Double p90Seconds
) {
}
