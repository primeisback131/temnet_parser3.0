package com.temnet.temnet_parser.dto;

import java.time.LocalDateTime;
import java.util.List;

/**
 * The live backlog: tickets still open as of the freshest ingested message
 * ({@code asOf} — with a periodically refreshed dump this is the dump's age,
 * not the wall clock).
 */
public record Backlog(
        LocalDateTime asOf,
        List<BacklogTicket> tickets
) {
}
