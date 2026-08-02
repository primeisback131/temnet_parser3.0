package com.temnet.temnet_parser.dto;

/** Ticket count per problem category within one group. */
public record GroupCategoryCount(
        String groupName,
        String category,
        Long requests
) {
}
