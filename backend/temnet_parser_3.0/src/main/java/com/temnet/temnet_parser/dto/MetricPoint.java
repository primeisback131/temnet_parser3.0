package com.temnet.temnet_parser.dto;

import java.time.LocalDate;

/**
 * One point of a time series: aggregated counts for a single time bucket.
 * {@code backlog} is the number of tickets still open at the END of the bucket.
 */
public record MetricPoint(
        LocalDate bucket,
        Long messages,
        Long closed,
        Long rejected,
        Long backlog
) {
}
