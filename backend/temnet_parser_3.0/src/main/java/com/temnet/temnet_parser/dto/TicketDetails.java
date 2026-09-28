package com.temnet.temnet_parser.dto;

import java.util.List;

/** The tickets behind a card; {@code truncated} - the list hit its cap and holds only the newest. */
public record TicketDetails(List<TicketDetail> tickets, boolean truncated) {
}
