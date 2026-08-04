package com.temnet.temnet_parser.dto;

import java.time.LocalDateTime;
import java.util.List;

/** An application account as shown to the administrator (never the hash). */
public record UserAccount(
        Long id,
        String username,
        String fullName,
        String role,
        boolean enabled,
        LocalDateTime createdAt,
        List<Grant> grants
) {
    public static final String ROLE_ADMIN = "admin";
    public static final String ROLE_MANAGER = "manager";
    /**
     * Read-only account ("Пользователь"): the company and per-user tables for
     * the groups it was granted, and nothing else — no metrics dashboard, no
     * operator leaderboard, no chats, no Excel export.
     */
    public static final String ROLE_USER = "user";
}
