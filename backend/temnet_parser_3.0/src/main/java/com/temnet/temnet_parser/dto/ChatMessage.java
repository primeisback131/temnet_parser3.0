package com.temnet.temnet_parser.dto;

import java.time.LocalDateTime;

/**
 * A single message of a client <-> support conversation. {@code client} is
 * the non-support side whatever the direction; {@code direction} is
 * {@code in} (the client wrote) or {@code out} (an operator answered) — the
 * screen decides the bubble side from it, not from the account name.
 */
public record ChatMessage(
        String client,
        String sender,
        String recipient,
        String direction,
        String message,
        LocalDateTime createdAt
) {
}
