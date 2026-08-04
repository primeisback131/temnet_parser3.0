package com.temnet.temnet_parser.analytics;

import java.time.LocalDateTime;

/** Mutable image of a `ticket` row while the sync state machine works on it. */
class Ticket {

    Long id;
    final String client;
    String account;
    final LocalDateTime openedAt;
    LocalDateTime lastActivity;
    LocalDateTime firstResponseAt;
    String firstResponder;
    Long frtSeconds;
    LocalDateTime inProgressAt;
    LocalDateTime closedAt;
    String closedBy;
    Long resolutionSeconds;
    String status = "open";
    int categoryRank;
    int messagesIn;
    int messagesOut;
    Long reopenedFrom;
    int reopenScore;
    String reopenLlm;

    Ticket(String client, LocalDateTime openedAt) {
        this.client = client;
        this.openedAt = openedAt;
        this.lastActivity = openedAt;
    }
}
