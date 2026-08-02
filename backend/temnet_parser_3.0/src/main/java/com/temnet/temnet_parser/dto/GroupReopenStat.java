package com.temnet.temnet_parser.dto;

/** Repeat-request counts for one group over a whole report period. */
public record GroupReopenStat(
        String groupName,
        Long closed,
        Long probable,
        Long confirmed
) {
}
