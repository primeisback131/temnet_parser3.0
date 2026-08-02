package com.temnet.temnet_parser.dto;

import java.time.LocalDate;

/** One day of a group's dynamics: message volume and ticket closures. */
public record GroupDailyPoint(
        String groupName,
        LocalDate bucket,
        Long messages,
        Long closed,
        Long rejected
) {
}
