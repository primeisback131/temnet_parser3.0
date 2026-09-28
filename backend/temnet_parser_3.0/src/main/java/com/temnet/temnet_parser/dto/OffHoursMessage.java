package com.temnet.temnet_parser.dto;

import java.time.LocalDateTime;

/** One incoming message outside the working day, behind the off-hours card. */
public record OffHoursMessage(String client, String groupNames, LocalDateTime at) {
}
