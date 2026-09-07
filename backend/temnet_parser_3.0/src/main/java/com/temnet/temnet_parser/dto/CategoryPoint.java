package com.temnet.temnet_parser.dto;

import java.time.LocalDate;

/** Tickets of one category opened in one time bucket. */
public record CategoryPoint(
        LocalDate bucket,
        String category,
        Long requests
) {
}
