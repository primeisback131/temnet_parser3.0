package com.temnet.temnet_parser.controller;

import com.temnet.temnet_parser.dto.CurrentUser;
import com.temnet.temnet_parser.security.AccessControlService;
import com.temnet.temnet_parser.security.ActiveSessions;
import com.temnet.temnet_parser.security.ClientIp;
import com.temnet.temnet_parser.security.AppPrincipal;
import com.temnet.temnet_parser.security.LoginAttemptService;
import com.temnet.temnet_parser.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    /** Login form payload. */
    public record LoginRequest(String username, String password) {
    }

    /** Self-service password change; the current password proves it is the owner. */
    public record PasswordChangeRequest(String currentPassword, String newPassword) {
    }

    private final AuthenticationManager authenticationManager;
    private final AccessControlService accessControl;
    private final LoginAttemptService loginAttempts;
    private final UserService userService;
    private final SecurityContextRepository contextRepository;
    private final ActiveSessions activeSessions;

    public AuthController(AuthenticationManager authenticationManager,
                          AccessControlService accessControl,
                          LoginAttemptService loginAttempts,
                          UserService userService,
                          SecurityContextRepository contextRepository,
                          ActiveSessions activeSessions) {
        this.authenticationManager = authenticationManager;
        this.accessControl = accessControl;
        this.loginAttempts = loginAttempts;
        this.userService = userService;
        this.contextRepository = contextRepository;
        this.activeSessions = activeSessions;
    }

    @PostMapping("/login")
    public CurrentUser login(@RequestBody LoginRequest body,
                             HttpServletRequest request, HttpServletResponse response) {
        String username = body.username() == null ? "" : body.username().trim();
        String ip = ClientIp.of(request);

        if (loginAttempts.isBlocked(username, ip)) {
            log.warn("Вход отклонён: превышен лимит неудачных попыток, user='{}' ip={}", username, ip);
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "Слишком много неудачных попыток входа, попробуйте позже");
        }

        Authentication auth;
        try {
            auth = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(username, body.password()));
        } catch (AuthenticationException e) {
            loginAttempts.recordFailure(username, ip);
            log.warn("Неудачный вход: user='{}' ip={}", username, ip);
            // Deliberately vague: never reveal whether the login exists.
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Неверный логин или пароль");
        }
        loginAttempts.recordSuccess(username);

        // Session fixation: whatever session id the browser held before the
        // login must not survive it. getSession(true) alone keeps an existing
        // id, so an existing session gets a new one explicitly.
        if (request.getSession(false) != null) {
            request.changeSessionId();
        } else {
            request.getSession(true);
        }

        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(auth);
        SecurityContextHolder.setContext(context);
        contextRepository.saveContext(context, request, response);
        activeSessions.register(request.getSession().getId(), username, ip, request.getHeader("User-Agent"));

        log.info("Вход выполнен: user='{}' ip={}", username, ip);
        return accessControl.describe();
    }

    @PostMapping("/logout")
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        new SecurityContextLogoutHandler()
                .logout(request, response, SecurityContextHolder.getContext().getAuthentication());
    }

    /** Who am I and what may I see — drives the whole UI. */
    @GetMapping("/me")
    public CurrentUser me() {
        return accessControl.describe();
    }

    /**
     * Changes the caller's own password. This is the one thing an account
     * holding a temporary password may do, and what clears that state.
     */
    @PostMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(@RequestBody PasswordChangeRequest body) {
        AppPrincipal user = accessControl.currentUser();
        userService.changeOwnPassword(user.id(), body.currentPassword(), body.newPassword());
        log.info("Пароль изменён владельцем: user='{}'", user.getUsername());
    }
}
