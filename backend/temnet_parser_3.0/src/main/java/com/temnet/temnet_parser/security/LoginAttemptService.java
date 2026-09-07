package com.temnet.temnet_parser.security;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Locale;
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

    private final int maxFailuresPerUser;
    private final int maxFailuresPerIp;
    private final Cache<String, AtomicInteger> failuresByUser;
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
        return count(failuresByUser, key(username)) >= maxFailuresPerUser
                || count(failuresByIp, ip) >= maxFailuresPerIp;
    }

    public void recordFailure(String username, String ip) {
        failuresByUser.get(key(username), k -> new AtomicInteger()).incrementAndGet();
        failuresByIp.get(ip, k -> new AtomicInteger()).incrementAndGet();
    }

    /** A successful login clears the name's counter; the address keeps its history. */
    public void recordSuccess(String username) {
        failuresByUser.invalidate(key(username));
    }

    /** Lifts every lockout at once: an administrator unblocking a user whose address is banned. */
    public void clearAll() {
        failuresByUser.invalidateAll();
        failuresByIp.invalidateAll();
    }

    private static int count(Cache<String, AtomicInteger> cache, String key) {
        AtomicInteger counter = cache.getIfPresent(key);
        return counter == null ? 0 : counter.get();
    }

    private static String key(String username) {
        return username == null ? "" : username.trim().toLowerCase(Locale.ROOT);
    }
}
