package com.temnet.temnet_parser.dto;

import java.time.LocalDateTime;

/** A single chat message between a user and the support ("help") side. */
public record ChatMessage(
        String sender,
        String recipient,
        String message,
        LocalDateTime createdAt
) {
}
