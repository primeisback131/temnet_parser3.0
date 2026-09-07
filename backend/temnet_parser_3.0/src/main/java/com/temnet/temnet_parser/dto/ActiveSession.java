package com.temnet.temnet_parser.dto;

import java.time.Instant;

/**
 * A row of the maintenance screen's session list: a signed-in session, or a
 * login name / address that the brute-force limiter is currently blocking
 * (then {@code id}, {@code loginAt} and {@code lastSeen} are null and
 * {@code blocked} is true). {@code id} is the handle for ending the session;
 * {@code current} marks the caller's own.
 */
public record ActiveSession(String id, boolean current, String username, String ip, String userAgent,
                            Instant loginAt, Instant lastSeen, boolean blocked) {
}
