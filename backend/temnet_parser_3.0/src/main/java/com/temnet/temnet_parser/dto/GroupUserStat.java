package com.temnet.temnet_parser.dto;

/** Per-user statistics with the user's group, for reports spanning many groups. */
public record GroupUserStat(
        String groupName,
        String userName,
        Long closedRequests,
        Long rejectedRequests,
        Long totalMessages
) {
}
