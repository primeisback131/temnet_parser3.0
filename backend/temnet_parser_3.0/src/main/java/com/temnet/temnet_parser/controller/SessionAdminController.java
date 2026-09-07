package com.temnet.temnet_parser.controller;

import com.temnet.temnet_parser.dto.ActiveSession;
import com.temnet.temnet_parser.security.ActiveSessions;
import com.temnet.temnet_parser.security.LoginAttemptService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Who is signed in and who is locked out. The whole /admin/** tree is administrators only. */
@RestController
@RequestMapping("/admin/sessions")
public class SessionAdminController {

    public record UnlockRequest(String username, String ip) {
    }

    private final ActiveSessions activeSessions;
    private final LoginAttemptService loginAttempts;

    public SessionAdminController(ActiveSessions activeSessions, LoginAttemptService loginAttempts) {
        this.activeSessions = activeSessions;
        this.loginAttempts = loginAttempts;
    }

    /**
     * Signed-in sessions first, then the lockouts that have no session
     * behind them: a login name someone hammered with wrong passwords, or
     * an address that ran out of attempts.
     */
    @GetMapping
    public List<ActiveSession> list(HttpServletRequest request) {
        String own = activeSessions.idOf(request.getSession(false));
        List<ActiveSession> rows = new ArrayList<>();
        Set<String> seenUsers = new HashSet<>();
        Set<String> seenIps = new HashSet<>();
        for (ActiveSessions.Entry e : activeSessions.list()) {
            rows.add(new ActiveSession(e.id, e.id.equals(own), e.username, e.ip, e.userAgent, e.loginAt,
                    e.lastSeen, loginAttempts.isBlocked(e.username, e.ip)));
            seenUsers.add(e.username.toLowerCase(Locale.ROOT));
            seenIps.add(e.ip);
        }
        for (LoginAttemptService.Lockout lockout : loginAttempts.blockedUsers()) {
            if (seenUsers.add(lockout.username())) {
                rows.add(new ActiveSession(null, false, lockout.username(), lockout.ip(), "", null, null, true));
                seenIps.add(lockout.ip());
            }
        }
        for (String ip : loginAttempts.blockedIps()) {
            if (seenIps.add(ip)) {
                rows.add(new ActiveSession(null, false, "", ip, "", null, null, true));
            }
        }
        return rows;
    }

    /** Ends someone else's session; the caller's own is refused rather than pulling the rug. */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void terminate(@PathVariable String id, HttpServletRequest request) {
        if (id.equals(activeSessions.idOf(request.getSession(false)))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Свой сеанс завершается через выход");
        }
        if (!activeSessions.terminate(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Сеанс уже завершён");
        }
    }

    /** Lifts the lockout on the row's login name and address. */
    @PostMapping("/unlock")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unlock(@RequestBody UnlockRequest body) {
        loginAttempts.unblock(body.username(), body.ip());
    }
}
