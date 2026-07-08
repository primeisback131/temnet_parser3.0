package com.temnet.temnet_parser.dto;

/** Per-operator performance stats over a period. */
public record OperatorStat(
        String operator,
        Long messages,
        Long closed,
        Long rejected,
        Long clients,
        Double avgReplySeconds
) {
}
