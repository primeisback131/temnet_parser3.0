package com.temnet.temnet_parser.security;

import jakarta.servlet.http.HttpSession;
import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Who is signed in right now: one entry per HTTP session, added at login
 * and dropped when the container invalidates the session (logout, timeout,
 * or the account being disabled). In memory, like the sessions themselves.
 */
@Component
public class ActiveSessions implements HttpSessionListener {

    /**
     * One signed-in session. {@code id} is a random handle for the admin
     * screen, so the real session id never leaves the server.
     * {@code lastSeen} moves on every request.
     */
    public static final class Entry {
        public final String id = UUID.randomUUID().toString();
        final HttpSession session;
        public final String username;
        public final String ip;
        public final String userAgent;
        public final Instant loginAt;
        public volatile Instant lastSeen;

        Entry(HttpSession session, String username, String ip, String userAgent, Instant loginAt) {
            this.session = session;
            this.username = username;
            this.ip = ip;
            this.userAgent = userAgent;
            this.loginAt = loginAt;
            this.lastSeen = loginAt;
        }
    }

    private final Map<String, Entry> sessions = new ConcurrentHashMap<>();

    public void register(HttpSession session, String username, String ip, String userAgent) {
        sessions.put(session.getId(),
                new Entry(session, username, ip, userAgent == null ? "" : userAgent, Instant.now()));
    }

    /** The handle of the caller's own session, so the screen can protect it. */
    public String idOf(HttpSession session) {
        Entry entry = session == null ? null : sessions.get(session.getId());
        return entry == null ? null : entry.id;
    }

    /**
     * Ends the session behind a handle: its owner gets 401 on the next
     * request. Returns false when no such session exists (already gone).
     */
    public boolean terminate(String id) {
        for (Map.Entry<String, Entry> e : sessions.entrySet()) {
            if (e.getValue().id.equals(id)) {
                try {
                    e.getValue().session.invalidate(); // sessionDestroyed() removes the entry
                } catch (IllegalStateException alreadyInvalid) {
                    sessions.remove(e.getKey());
                }
                return true;
            }
        }
        return false;
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
