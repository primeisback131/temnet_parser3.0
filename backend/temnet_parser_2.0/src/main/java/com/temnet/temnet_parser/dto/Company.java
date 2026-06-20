package com.temnet.temnet_parser.dto;

/** Aggregated request/message statistics for a single group (company). */
public record Company(
        String groupName,
        Long activeUsers,
        Long totalUsers,
        Long closedRequests,
        Long rejectedRequests,
        Long requestsInProgress,
        Long totalMessages
) {
}
