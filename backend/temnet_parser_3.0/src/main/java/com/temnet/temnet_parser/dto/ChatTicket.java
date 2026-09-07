package com.temnet.temnet_parser.dto;

import java.time.LocalDateTime;

/**
 * A ticket of the conversation on screen, drawn as markers between messages:
 * where it opened (and its category), when it was taken into work, where and
 * by whom it was closed and how long that took. {@code reopen} is the
 * probable-repeat rule of the reopens metric; {@code lastActivity} is where an
 * expired ticket's marker goes.
 */
public record ChatTicket(
        LocalDateTime openedAt,
        LocalDateTime inProgressAt,
        LocalDateTime closedAt,
        LocalDateTime lastActivity,
        String status,
        String category,
        Long frtSeconds,
        Long resolutionSeconds,
        String closedBy,
        Boolean reopen,
        Boolean thanked
) {
}
