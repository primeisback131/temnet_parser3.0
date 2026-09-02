package com.temnet.temnet_parser.service;

import com.temnet.temnet_parser.dto.Grant;
import com.temnet.temnet_parser.dto.HelpAccountScope;
import com.temnet.temnet_parser.dto.UserAccount;
import com.temnet.temnet_parser.repository.UserRepository;
import com.temnet.temnet_parser.security.AppPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.CacheManager;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Set;

/** Managing application accounts and their grants. */
@Service
public class UserService {

    private static final Logger log = LoggerFactory.getLogger(UserService.class);
    private static final Set<String> ROLES =
            Set.of(UserAccount.ROLE_ADMIN, UserAccount.ROLE_MANAGER, UserAccount.ROLE_USER);
    private static final Set<String> SCOPE_TYPES = Set.of(Grant.HELP_ACCOUNT, Grant.GROUP);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final CacheManager cacheManager;
    private final String initialAdminPassword;

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder, CacheManager cacheManager,
                       @Value("${app.admin.initial-password:}") String initialAdminPassword) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.cacheManager = cacheManager;
        this.initialAdminPassword = initialAdminPassword;
    }

    /**
     * Creates the first administrator on an empty install, so a fresh
     * deployment is reachable without touching the database by hand. The
     * password comes from APP_ADMIN_PASSWORD, or is generated and logged once.
     */
    public void ensureAdminExists() {
        if (userRepository.countUsers() > 0) {
            return;
        }
        String password = initialAdminPassword.isBlank() ? randomPassword() : initialAdminPassword;
        userRepository.create("admin", passwordEncoder.encode(password), "Администратор",
                UserAccount.ROLE_ADMIN, true);
        if (initialAdminPassword.isBlank()) {
            log.warn("Создан аккаунт administrator 'admin' с временным паролем: {} — смените его после входа",
                    password);
        } else {
            log.info("Создан аккаунт администратора 'admin' с паролем из APP_ADMIN_PASSWORD");
        }
    }

    private static String randomPassword() {
        byte[] bytes = new byte[12];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public List<UserAccount> list() {
        return userRepository.findAll();
    }

    public List<HelpAccountScope> allHelpAccounts() {
        return userRepository.allHelpAccounts();
    }

    public long create(String username, String password, String fullName, String role, boolean enabled,
                       List<Grant> grants) {
        validate(username, role, grants);
        if (password == null || password.length() < 8) {
            throw new IllegalArgumentException("Пароль должен быть не короче 8 символов");
        }
        long id = userRepository.create(username.trim(), passwordEncoder.encode(password), fullName, role, enabled);
        userRepository.replaceGrants(id, forRole(role, grants));
        evictScopes();
        return id;
    }

    /**
     * Demoting or disabling the last active administrator is refused for the
     * same reason deleting one is: nobody would be left to manage accounts.
     */
    public void update(long id, String fullName, String role, boolean enabled, List<Grant> grants) {
        validate(null, role, grants);
        AppPrincipal target = require(id);
        boolean stopsBeingAdmin = target.isAdmin() && target.isEnabled()
                && (!UserAccount.ROLE_ADMIN.equals(role) || !enabled);
        if (stopsBeingAdmin) {
            requireAnotherAdmin(id);
        }
        userRepository.updateProfile(id, fullName, role, enabled);
        userRepository.replaceGrants(id, forRole(role, grants));
        evictScopes();
    }

    /**
     * A read-only account never reads correspondence, so the chat flag is
     * cleared rather than merely hidden in the UI — otherwise a grant kept from
     * the time the account was a manager would quietly survive the demotion.
     */
    private static List<Grant> forRole(String role, List<Grant> grants) {
        if (!UserAccount.ROLE_USER.equals(role)) {
            return grants;
        }
        return grants.stream()
                .map(g -> new Grant(g.scopeType(), g.scopeValue(), g.canMetrics(), false))
                .toList();
    }

    public void changePassword(long id, String password) {
        if (password == null || password.length() < 8) {
            throw new IllegalArgumentException("Пароль должен быть не короче 8 символов");
        }
        userRepository.updatePassword(id, passwordEncoder.encode(password));
    }

    /**
     * Deleting yourself would end the very session doing it, and deleting the
     * last administrator would leave nobody able to manage accounts - the
     * bootstrap only runs on an empty table, so with other accounts around
     * that state is permanent.
     */
    public void delete(long id, long requestedBy) {
        if (id == requestedBy) {
            throw new IllegalArgumentException("Нельзя удалить собственную учётную запись");
        }
        AppPrincipal target = require(id);
        if (target.isAdmin() && target.isEnabled()) {
            requireAnotherAdmin(id);
        }
        userRepository.delete(id);
        evictScopes();
    }

    private AppPrincipal require(long id) {
        return userRepository.findPrincipalById(id)
                .orElseThrow(() -> new IllegalArgumentException("Пользователь не найден"));
    }

    private void requireAnotherAdmin(long exceptId) {
        if (userRepository.countEnabledAdminsExcluding(exceptId) == 0) {
            throw new IllegalArgumentException("Нельзя лишить прав последнего администратора");
        }
    }

    private void validate(String username, String role, List<Grant> grants) {
        if (username != null && username.isBlank()) {
            throw new IllegalArgumentException("Логин обязателен");
        }
        if (!ROLES.contains(role)) {
            throw new IllegalArgumentException("Неизвестная роль: " + role);
        }
        for (Grant g : grants) {
            if (!SCOPE_TYPES.contains(g.scopeType())) {
                throw new IllegalArgumentException("Неизвестный тип доступа: " + g.scopeType());
            }
            if (g.scopeValue() == null || g.scopeValue().isBlank()) {
                throw new IllegalArgumentException("Пустое значение доступа");
            }
        }
    }

    /** Permissions are cached per user; a change must take effect at once. */
    private void evictScopes() {
        var cache = cacheManager.getCache("accessibleGroups");
        if (cache != null) {
            cache.clear();
        }
    }
}
