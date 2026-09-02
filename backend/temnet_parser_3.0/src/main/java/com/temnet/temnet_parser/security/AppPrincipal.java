package com.temnet.temnet_parser.security;

import com.temnet.temnet_parser.dto.UserAccount;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;
import java.util.Objects;

/**
 * The signed-in account, carrying its id so grants can be looked up.
 * <p>
 * A snapshot: it is loaded at login and refreshed from the database on every
 * request by {@link AccountRefreshFilter}, so a role change, a lock or a
 * deletion takes effect at once rather than when the session expires.
 */
public class AppPrincipal implements UserDetails {

    private final Long id;
    private final String username;
    private final String fullName;
    private final String passwordHash;
    private final String role;
    private final boolean enabled;
    private final boolean mustChangePassword;

    public AppPrincipal(Long id, String username, String fullName, String passwordHash,
                        String role, boolean enabled, boolean mustChangePassword) {
        this.id = id;
        this.username = username;
        this.fullName = fullName;
        this.passwordHash = passwordHash;
        this.role = role;
        this.enabled = enabled;
        this.mustChangePassword = mustChangePassword;
    }

    public Long id() {
        return id;
    }

    public String fullName() {
        return fullName;
    }

    public String role() {
        return role;
    }

    /**
     * A temporary password — generated at install or issued by an
     * administrator — has to be replaced before anything else is allowed.
     */
    public boolean mustChangePassword() {
        return mustChangePassword;
    }

    /** Administrators bypass every scope check. */
    public boolean isAdmin() {
        return UserAccount.ROLE_ADMIN.equals(role);
    }

    /**
     * True when both snapshots describe the same account state, so the
     * per-request refresh can skip rewriting an unchanged session.
     */
    public boolean sameAs(AppPrincipal other) {
        return other != null
                && Objects.equals(id, other.id)
                && Objects.equals(username, other.username)
                && Objects.equals(fullName, other.fullName)
                && Objects.equals(role, other.role)
                && enabled == other.enabled
                && mustChangePassword == other.mustChangePassword;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.toUpperCase()));
    }

    @Override
    public String getPassword() {
        return passwordHash;
    }

    @Override
    public String getUsername() {
        return username;
    }

    @Override
    public boolean isEnabled() {
        return enabled;
    }
}
