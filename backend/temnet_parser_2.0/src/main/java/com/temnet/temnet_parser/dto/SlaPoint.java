package com.temnet.temnet_parser.dto;

import java.time.LocalDate;

/**
 * First-response-time stats for one time bucket.
 * {@code responses} is the number of client requests that got an operator
 * reply; {@code avgSeconds} is the average wait until that first reply.
 */
public record SlaPoint(
        LocalDate bucket,
        Long responses,
        Double avgSeconds,
        Double p50Seconds,
        Double p90Seconds
) {
}
