package com.temnet.temnet_parser.security;

import com.temnet.temnet_parser.dto.CurrentUser;
import com.temnet.temnet_parser.repository.UserRepository;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Resolves what the signed-in user may see. Every endpoint that exposes group
 * data goes through here — the UI hides things too, but this is the check that
 * actually enforces it.
 * <p>
 * Grants are read from the database on each call. They are a handful of rows
 * in tiny tables, and reading them fresh means a changed grant applies to the
 * very next request — no cache to keep coherent.
 */
@Service
public class AccessControlService {

    /** Which kind of data a request wants; chats are granted separately. */
    public enum Area {METRICS, CHATS}

    private final UserRepository userRepository;

    public AccessControlService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public AppPrincipal currentUser() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getPrincipal() instanceof AppPrincipal user) {
            return user;
        }
        throw new AccessDeniedException("Не аутентифицирован");
    }

    /**
     * The groups this request may touch. Administrators are unrestricted;
     * a manager asking for one group must have been granted it, otherwise the
     * request is refused rather than silently narrowed.
     */
    public Scope scope(String requestedGroup, Area area) {
        AppPrincipal user = currentUser();
        boolean single = requestedGroup != null && !requestedGroup.isBlank();

        if (user.isAdmin()) {
            return single ? Scope.all().within(requestedGroup) : Scope.all();
        }

        boolean chats = area == Area.CHATS;
        Scope granted = Scope.of(userRepository.accessibleAccounts(user.id(), chats),
                userRepository.accessibleOwnGroups(user.id(), chats));
        if (!single) {
            return granted;
        }
        // Asking for one group narrows the grants, never widens them: inside a
        // shared organization a desk still sees only its own work.
        if (!groups(user.id(), area).contains(requestedGroup)) {
            throw new AccessDeniedException("Нет доступа к группе " + requestedGroup);
        }
        return granted.within(requestedGroup);
    }

    /**
     * Groups the user may see listed at all — desks expand to the groups they
     * serve. Used for pickers and for the company table's row list; the numbers
     * inside those rows are still filtered by {@link #scope}. Empty for an
     * administrator, which every consumer reads as "no restriction".
     */
    public List<String> visibleGroups(Area area) {
        AppPrincipal user = currentUser();
        return user.isAdmin() ? List.of() : groups(user.id(), area);
    }

    /** Help accounts the caller may report on; empty for an administrator, who may report on any. */
    public List<String> grantedHelpAccounts() {
        AppPrincipal user = currentUser();
        return user.isAdmin() ? List.of() : userRepository.accessibleHelpAccounts(user.id());
    }

    /** Refuses a help-account report the user was not granted. */
    public void checkHelpAccount(String account) {
        AppPrincipal user = currentUser();
        if (user.isAdmin()) {
            return;
        }
        if (!userRepository.accessibleHelpAccounts(user.id()).contains(account)) {
            throw new AccessDeniedException("Нет доступа к help-аккаунту " + account);
        }
    }

    private List<String> groups(long userId, Area area) {
        return userRepository.accessibleGroups(userId, area == Area.CHATS);
    }

    /** The signed-in user as the frontend needs it, with resolved scopes. */
    public CurrentUser describe() {
        AppPrincipal user = currentUser();
        if (user.isAdmin()) {
            return new CurrentUser(user.getUsername(), user.fullName(), user.role(), user.mustChangePassword(),
                    true, List.of(), List.of(),
                    userRepository.allHelpAccounts().stream().map(a -> a.account()).toList());
        }
        return new CurrentUser(user.getUsername(), user.fullName(), user.role(), user.mustChangePassword(),
                false,
                groups(user.id(), Area.METRICS),
                groups(user.id(), Area.CHATS),
                userRepository.accessibleHelpAccounts(user.id()));
    }
}
