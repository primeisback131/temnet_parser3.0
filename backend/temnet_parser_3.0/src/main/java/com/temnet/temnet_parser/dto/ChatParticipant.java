package com.temnet.temnet_parser.dto;

import java.time.LocalDateTime;

/** A row of the chat screen's conversation list: who, how much, and the last thing said. */
public record ChatParticipant(
        String client,
        LocalDateTime lastAt,
        Long messages,
        String lastText,
        String lastDirection
) {
}
