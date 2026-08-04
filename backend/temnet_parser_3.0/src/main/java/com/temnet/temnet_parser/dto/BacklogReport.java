package com.temnet.temnet_parser.dto;

import java.time.LocalDateTime;

/**
 * Tickets still open at the end of the period.
 * {@code asOf} is the moment the count actually describes: the requested
 * period end, or the freshest ingested message when the period reaches past
 * the data.
 */
public record BacklogReport(
        LocalDateTime asOf,
        Long openTickets
) {
}
