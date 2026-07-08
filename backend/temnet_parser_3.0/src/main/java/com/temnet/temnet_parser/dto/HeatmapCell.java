package com.temnet.temnet_parser.dto;

/**
 * One cell of the load heatmap: message count for a given weekday/hour.
 * {@code weekday} is 0 = Monday .. 6 = Sunday (MariaDB WEEKDAY()).
 */
public record HeatmapCell(
        Integer weekday,
        Integer hour,
        Long messages
) {
}
