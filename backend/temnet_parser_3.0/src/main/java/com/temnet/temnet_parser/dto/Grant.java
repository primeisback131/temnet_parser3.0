package com.temnet.temnet_parser.dto;

/**
 * One granted scope of a user: a whole help account (expanded to the groups
 * it serves) or a single client group. Metrics and chats are granted
 * separately — aggregates are not the correspondence itself.
 */
public record Grant(
        String scopeType,   // help_account | group
        String scopeValue,
        boolean canMetrics,
        boolean canChats
) {
    public static final String HELP_ACCOUNT = "help_account";
    public static final String GROUP = "group";
}
