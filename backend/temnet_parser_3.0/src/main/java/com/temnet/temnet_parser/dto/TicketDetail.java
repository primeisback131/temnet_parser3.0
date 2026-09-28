package com.temnet.temnet_parser.dto;

import java.time.LocalDateTime;

/**
 * One ticket behind a ticket card of the metrics screen. {@code status} is the
 * effective one (an abandoned 'open' ticket reads 'expired'); the booleans are
 * the per-row forms of the {@link PeriodSummary} counts, so the screen filters
 * rows by them instead of re-deriving the thresholds. Durations are WORKING
 * seconds.
 */
public record TicketDetail(
        String client,
        String groupNames,
        LocalDateTime openedAt,
        LocalDateTime lastActivity,
        LocalDateTime closedAt,
        String status,
        String category,
        Integer messagesIn,
        Integer messagesOut,
        String firstResponder,
        Long frtSeconds,
        String closedBy,
        Long resolutionSeconds,
        Boolean noReply,
        Boolean awaiting,
        Boolean thanked,
        Boolean reopened,
        Boolean answered,
        Boolean answeredFast,
        Boolean answeredHour,
        Boolean resolved,
        Boolean resolvedHour,
        Boolean resolvedDay
) {
}
