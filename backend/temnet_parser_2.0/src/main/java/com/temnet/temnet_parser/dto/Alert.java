package com.temnet.temnet_parser.dto;

/**
 * One detected anomaly in the last week of ingested data.
 * {@code type} is "message_spike" (message volume vs the group's weekly
 * baseline) or "sla_degradation" (average first response vs baseline).
 */
public record Alert(
        String type,
        String groupName,
        Double current,
        Double baseline,
        Double ratio
) {
}
