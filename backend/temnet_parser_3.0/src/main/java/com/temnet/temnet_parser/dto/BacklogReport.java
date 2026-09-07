package com.temnet.temnet_parser.dto;

import java.time.LocalDateTime;

/**
 * Tickets still open at the end of the period.
 * {@code asOf} is the moment the count actually describes: the requested
 * period end, or the freshest ingested message when the period reaches past
 * the data. The {@code age*} buckets split the count by how many CALENDAR
 * days the tickets have been open (up to 1, 2-3, 4-7, 8-30, more); they sum
 * to {@code openTickets}. {@code oldestOpenedAt} is null when nothing is open.
 */
public record BacklogReport(
        LocalDateTime asOf,
        Long openTickets,
        Long ageDay,
        Long ageThreeDays,
        Long ageWeek,
        Long ageMonth,
        Long ageOlder,
        LocalDateTime oldestOpenedAt
) {
}
