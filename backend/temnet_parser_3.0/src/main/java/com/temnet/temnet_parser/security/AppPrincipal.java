package com.temnet.temnet_parser.security;

import com.temnet.temnet_parser.dto.UserAccount;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;

/** The signed-in account, carrying its id so grants can be looked up. */
public class AppPrincipal implements UserDetails {

    private final Long id;
    private final String username;
    private final String fullName;
    private final String passwordHash;
    private final String role;
    private final boolean enabled;

    public AppPrincipal(Long id, String username, String fullName, String passwordHash,
                        String role, boolean enabled) {
        this.id = id;
        this.username = username;
        this.fullName = fullName;
        this.passwordHash = passwordHash;
        this.role = role;
        this.enabled = enabled;
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

    /** Administrators bypass every scope check. */
    public boolean isAdmin() {
        return UserAccount.ROLE_ADMIN.equals(role);
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
