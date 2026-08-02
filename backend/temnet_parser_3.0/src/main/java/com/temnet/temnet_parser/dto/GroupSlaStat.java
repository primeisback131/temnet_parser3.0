package com.temnet.temnet_parser.dto;

/** First-response-time stats for one group over a whole report period. */
public record GroupSlaStat(
        String groupName,
        Long responses,
        Double avgSeconds,
        Double p50Seconds,
        Double p90Seconds
) {
}
