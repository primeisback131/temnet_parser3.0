package com.temnet.temnet_parser.dto;

/**
 * Per-operator performance stats over a period. {@code reopened} closures
 * came back as a repeat request; {@code thanked} ones the client acknowledged.
 */
public record OperatorStat(
        String operator,
        Long messages,
        Long closed,
        Long rejected,
        Long reopened,
        Long thanked,
        Long clients,
        Double avgReplySeconds
) {
}
