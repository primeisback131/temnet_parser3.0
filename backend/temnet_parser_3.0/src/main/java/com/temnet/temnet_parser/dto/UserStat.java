package com.temnet.temnet_parser.dto;

/** Aggregated request/message statistics for a single user within a group. */
public record UserStat(
        String userName,
        Long closedRequests,
        Long rejectedRequests,
        Long openRequests,
        Long totalMessages
) {
}
