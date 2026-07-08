package com.temnet.temnet_parser.dto;

import java.time.LocalDate;

/** One point of a time series: aggregated counts for a single time bucket. */
public record MetricPoint(
        LocalDate bucket,
        Long messages,
        Long closed,
        Long rejected,
        Long inProgress
) {
}
