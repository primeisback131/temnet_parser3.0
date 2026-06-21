package com.temnet.temnet_parser.dto;

/** Number of client requests that fell into a given problem category. */
public record CategoryCount(
        String category,
        Long requests
) {
}
