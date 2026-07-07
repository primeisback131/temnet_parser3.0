package com.temnet.temnet_parser.dto;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Anomalies over the last 7 days of ingested data ({@code weekStart}..{@code asOf},
 * where asOf is the freshest message — the dump's age, not the wall clock),
 * compared against the preceding 8 weeks as baseline.
 */
public record AlertsReport(
        LocalDateTime asOf,
        LocalDateTime weekStart,
        List<Alert> alerts
) {
}
