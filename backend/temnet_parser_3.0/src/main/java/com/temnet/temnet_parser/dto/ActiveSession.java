package com.temnet.temnet_parser.dto;

import java.time.Instant;

/**
 * A row of the maintenance screen's session list: a signed-in session, or a
 * login name / address that the brute-force limiter is currently blocking
 * (then {@code loginAt} and {@code lastSeen} are null and {@code blocked}
 * is true).
 */
public record ActiveSession(String username, String ip, String userAgent,
                            Instant loginAt, Instant lastSeen, boolean blocked) {
}
