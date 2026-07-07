package com.temnet.temnet_parser.dto;

import java.time.LocalDateTime;

/**
 * One currently open ticket. {@code waitingSeconds} is WORKING time from the
 * opening message to the freshest ingested data ({@link Backlog#asOf}).
 */
public record BacklogTicket(
        String client,
        String groups,
        String category,
        LocalDateTime openedAt,
        LocalDateTime lastActivity,
        LocalDateTime firstResponseAt,
        Integer messagesIn,
        Integer messagesOut,
        Long waitingSeconds
) {
}
