package com.temnet.temnet_parser.dto;

import java.time.LocalDate;

/**
 * Repeat-request stats for one time bucket: closures (rate denominator),
 * probable reopens (any signal) and confirmed reopens (strong signal).
 */
public record ReopenPoint(
        LocalDate bucket,
        Long closed,
        Long probable,
        Long confirmed
) {
}
