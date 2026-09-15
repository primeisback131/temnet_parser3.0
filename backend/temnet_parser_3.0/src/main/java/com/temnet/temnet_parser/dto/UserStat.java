package com.temnet.temnet_parser.dto;

import java.time.LocalDateTime;

/** Aggregated request/message statistics for a single user within a group. */
public record UserStat(
        String userName,
        LocalDateTime lastSeenAt,
        Long closedRequests,
        Long rejectedRequests,
        Long openRequests,
        Long totalMessages
) {
}
