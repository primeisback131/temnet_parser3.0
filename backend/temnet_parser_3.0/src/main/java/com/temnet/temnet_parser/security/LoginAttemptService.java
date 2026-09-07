package com.temnet.temnet_parser.security;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Brute-force protection for the login endpoint: failed attempts are counted
 * per login name and per client address, and once either counter reaches
 * its limit further attempts are refused until the window expires.
 * <p>
 * In-memory on purpose: the application runs as a single instance, and a
 * restart clearing the counters is harmless.
 */
@Service
public class LoginAttemptService {

    /** Failures for one login name, and where the last one came from. */
    private static final class UserFailures {
        final AtomicInteger count = new AtomicInteger();
        volatile String lastIp = "";
    }

    /** A blocked login name and the address of its last failure, for the maintenance screen. */
    public record Lockout(String username, String ip) {
    }

    private final int maxFailuresPerUser;
    private final int maxFailuresPerIp;
    private final Cache<String, UserFailures> failuresByUser;
    private final Cache<String, AtomicInteger> failuresByIp;

    public LoginAttemptService(
            @Value("${app.auth.max-failures-per-user:10}") int maxFailuresPerUser,
            @Value("${app.auth.max-failures-per-ip:50}") int maxFailuresPerIp,
            @Value("${app.auth.lockout:PT15M}") Duration lockout) {
        this.maxFailuresPerUser = maxFailuresPerUser;
        this.maxFailuresPerIp = maxFailuresPerIp;
        this.failuresByUser = Caffeine.newBuilder().expireAfterWrite(lockout).maximumSize(100_000).build();
        this.failuresByIp = Caffeine.newBuilder().expireAfterWrite(lockout).maximumSize(100_000).build();
    }

    public boolean isBlocked(String username, String ip) {
        UserFailures failures = failuresByUser.getIfPresent(key(username));
        return (failures != null && failures.count.get() >= maxFailuresPerUser)
                || count(failuresByIp, ip) >= maxFailuresPerIp;
    }

    public void recordFailure(String username, String ip) {
        UserFailures failures = failuresByUser.get(key(username), k -> new UserFailures());
        failures.count.incrementAndGet();
        failures.lastIp = ip;
        failuresByIp.get(ip, k -> new AtomicInteger()).incrementAndGet();
    }

    /** Lifts the block on a login name and on an address; blank means "not that one". */
    public void unblock(String username, String ip) {
        if (username != null && !username.isBlank()) {
            failuresByUser.invalidate(key(username));
        }
        if (ip != null && !ip.isBlank()) {
            failuresByIp.invalidate(ip);
        }
    }

    /** Blocked login names with the address of their last failure. */
    public List<Lockout> blockedUsers() {
        return failuresByUser.asMap().entrySet().stream()
                .filter(e -> e.getValue().count.get() >= maxFailuresPerUser)
                .map(e -> new Lockout(e.getKey(), e.getValue().lastIp))
                .toList();
    }

    /** Blocked addresses. */
    public List<String> blockedIps() {
        return failuresByIp.asMap().entrySet().stream()
                .filter(e -> e.getValue().get() >= maxFailuresPerIp)
                .map(Map.Entry::getKey)
                .toList();
    }

    /** A successful login clears the name's counter; the address keeps its history. */
    public void recordSuccess(String username) {
        failuresByUser.invalidate(key(username));
    }

    private static int count(Cache<String, AtomicInteger> cache, String key) {
        AtomicInteger counter = cache.getIfPresent(key);
        return counter == null ? 0 : counter.get();
    }

    private static String key(String username) {
        return username == null ? "" : username.trim().toLowerCase(Locale.ROOT);
    }
}
