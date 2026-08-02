package com.temnet.temnet_parser.dto;

/** Ticket resolution-time stats for one group over a whole report period. */
public record GroupResolutionStat(
        String groupName,
        Long resolved,
        Double avgSeconds,
        Double p50Seconds,
        Double p90Seconds
) {
}
