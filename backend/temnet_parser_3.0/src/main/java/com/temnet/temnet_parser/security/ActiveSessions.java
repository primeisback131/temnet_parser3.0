package com.temnet.temnet_parser.security;

import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Who is signed in right now: one entry per HTTP session, added at login
 * and dropped when the container invalidates the session (logout, timeout,
 * or the account being disabled). In memory, like the sessions themselves.
 */
@Component
public class ActiveSessions implements HttpSessionListener {

    /** One signed-in session. {@code lastSeen} moves on every request. */
    public static final class Entry {
        public final String username;
        public final String ip;
        public final String userAgent;
        public final Instant loginAt;
        public volatile Instant lastSeen;

        Entry(String username, String ip, String userAgent, Instant loginAt) {
            this.username = username;
            this.ip = ip;
            this.userAgent = userAgent;
            this.loginAt = loginAt;
            this.lastSeen = loginAt;
        }
    }

    private final Map<String, Entry> sessions = new ConcurrentHashMap<>();

    public void register(String sessionId, String username, String ip, String userAgent) {
        sessions.put(sessionId, new Entry(username, ip, userAgent == null ? "" : userAgent, Instant.now()));
    }

    public void touch(String sessionId) {
        Entry entry = sessions.get(sessionId);
        if (entry != null) {
            entry.lastSeen = Instant.now();
        }
    }

    /** Newest activity first. */
    public List<Entry> list() {
        return sessions.values().stream()
                .sorted(Comparator.comparing((Entry e) -> e.lastSeen).reversed())
                .toList();
    }

    @Override
    public void sessionDestroyed(HttpSessionEvent event) {
        sessions.remove(event.getSession().getId());
    }
}
