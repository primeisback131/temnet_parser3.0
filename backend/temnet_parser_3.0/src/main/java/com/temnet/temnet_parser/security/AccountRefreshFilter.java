package com.temnet.temnet_parser.security;

import com.temnet.temnet_parser.repository.UserRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextHolderStrategy;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.Set;

/**
 * Re-reads the signed-in account from the database on every request.
 * <p>
 * The session only stores a snapshot taken at login. Without this filter a
 * deleted or disabled account, or a demoted administrator, would keep its
 * old rights until the session expired — for an administrator that is a
 * full bypass of every access check. Here the snapshot is replaced by the
 * live row (one primary-key lookup on a tiny table), the session is ended
 * when the account is gone, and an account holding a temporary password is
 * confined to the password-change endpoints.
 */
public class AccountRefreshFilter extends OncePerRequestFilter {

    /** What an account with a temporary password may still call. */
    private static final Set<String> ALLOWED_WHILE_PASSWORD_EXPIRED =
            Set.of("/auth/me", "/auth/password", "/auth/logout");

    private final UserRepository userRepository;
    private final SecurityContextRepository contextRepository;
    private final SecurityContextHolderStrategy holder = SecurityContextHolder.getContextHolderStrategy();

    public AccountRefreshFilter(UserRepository userRepository, SecurityContextRepository contextRepository) {
        this.userRepository = userRepository;
        this.contextRepository = contextRepository;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Authentication authentication = holder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AppPrincipal snapshot)) {
            chain.doFilter(request, response);
            return;
        }

        Optional<AppPrincipal> current = userRepository.findPrincipalById(snapshot.id());
        if (current.isEmpty() || !current.get().isEnabled()) {
            endSession(request, response);
            return;
        }

        AppPrincipal fresh = current.get();
        if (!fresh.sameAs(snapshot)) {
            // Role or profile changed since login: swap the principal so this
            // very request already runs with the new rights.
            UsernamePasswordAuthenticationToken renewed =
                    UsernamePasswordAuthenticationToken.authenticated(fresh, null, fresh.getAuthorities());
            renewed.setDetails(authentication.getDetails());
            SecurityContext context = holder.createEmptyContext();
            context.setAuthentication(renewed);
            holder.setContext(context);
            contextRepository.saveContext(context, request, response);
        }

        if (fresh.mustChangePassword() && !ALLOWED_WHILE_PASSWORD_EXPIRED.contains(pathWithinApplication(request))) {
            reply(response, HttpServletResponse.SC_FORBIDDEN,
                    "{\"message\":\"Требуется смена временного пароля\",\"code\":\"password_change_required\"}");
            return;
        }

        chain.doFilter(request, response);
    }

    /** The account was deleted or disabled: end the session right now. */
    private void endSession(HttpServletRequest request, HttpServletResponse response) throws IOException {
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        holder.clearContext();
        reply(response, HttpServletResponse.SC_UNAUTHORIZED,
                "{\"message\":\"Учётная запись отключена или удалена\"}");
    }

    private static void reply(HttpServletResponse response, int status, String json) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write(json);
    }

    /** The request path without the servlet context (the API's {@code /api} prefix). */
    private static String pathWithinApplication(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String context = request.getContextPath();
        return context != null && !context.isEmpty() && uri.startsWith(context)
                ? uri.substring(context.length())
                : uri;
    }
}
