package com.temnet.temnet_parser.dto;

import java.time.LocalDateTime;

/**
 * One ticket behind the backlog count — open at the end of the period.
 * {@code finalStatus}/{@code closedAt} tell what happened to it later, which
 * makes the number verifiable against the chat history by hand.
 */
public record OpenTicket(
        String client,
        String groupNames,
        LocalDateTime openedAt,
        LocalDateTime lastActivity,
        String category,
        Integer messagesIn,
        Integer messagesOut,
        String firstResponder,
        String finalStatus,
        LocalDateTime closedAt
) {
}
