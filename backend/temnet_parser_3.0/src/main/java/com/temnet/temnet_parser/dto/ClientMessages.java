package com.temnet.temnet_parser.dto;

/** A client's messages in the period; off-hours incoming split into weekday nights and weekends. */
public record ClientMessages(
        String client,
        String groupNames,
        Long messagesIn,
        Long messagesOut,
        Long offHoursNight,
        Long offHoursWeekend
) {
}
