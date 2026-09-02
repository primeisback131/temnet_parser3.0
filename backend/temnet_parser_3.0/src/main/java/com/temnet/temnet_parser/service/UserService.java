package com.temnet.temnet_parser.service;

import com.temnet.temnet_parser.dto.Grant;
import com.temnet.temnet_parser.dto.HelpAccountScope;
import com.temnet.temnet_parser.dto.UserAccount;
import com.temnet.temnet_parser.repository.UserRepository;
import com.temnet.temnet_parser.security.AppPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Set;

/**
 * Managing application accounts and their grants.
 * <p>
 * Every write runs in one transaction on the analytics database (the account
 * tables live there), so a failure half-way never leaves a user with some of
 * their grants. The transaction manager is named explicitly: the ejabberd dump
 * is the primary datasource and would otherwise be picked by default.
 */
@Service
public class UserService {

    private static final Logger log = LoggerFactory.getLogger(UserService.class);
    private static final int MIN_PASSWORD_LENGTH = 8;
    private static final Set<String> ROLES =
            Set.of(UserAccount.ROLE_ADMIN, UserAccount.ROLE_MANAGER, UserAccount.ROLE_USER);
    private static final Set<String> SCOPE_TYPES = Set.of(Grant.HELP_ACCOUNT, Grant.GROUP);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final String initialAdminPassword;

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder,
                       @Value("${app.admin.initial-password:}") String initialAdminPassword) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.initialAdminPassword = initialAdminPassword;
    }

    /**
     * Creates the first administrator on an empty install, so a fresh
     * deployment is reachable without touching the database by hand. The
     * password comes from APP_ADMIN_PASSWORD, or is generated and logged once —
     * and a generated one is temporary: it has to be replaced at first login,
     * so a password that once passed through a log file never stays valid.
     */
    @Transactional("analyticsTxManager")
    public void ensureAdminExists() {
        if (userRepository.countUsers() > 0) {
            return;
        }
        boolean generated = initialAdminPassword.isBlank();
        String password = generated ? randomPassword() : initialAdminPassword;
        userRepository.create("admin", passwordEncoder.encode(password), "Администратор",
                UserAccount.ROLE_ADMIN, true, generated);
        if (generated) {
            log.warn("Создан администратор 'admin' с временным паролем: {} — при первом входе его потребуется сменить",
                    password);
        } else {
            log.info("Создан администратор 'admin' с паролем из APP_ADMIN_PASSWORD");
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

    /** Creates an account with a temporary password the user replaces at first login. */
    @Transactional("analyticsTxManager")
    public long create(String username, String password, String fullName, String role, boolean enabled,
                       List<Grant> grants) {
        validate(username, role, grants);
        validatePassword(password);
        String login = username.trim();
        if (userRepository.findPrincipal(login).isPresent()) {
            throw new IllegalArgumentException("Логин уже занят: " + login);
        }
        long id = userRepository.create(login, passwordEncoder.encode(password), fullName, role, enabled, true);
        userRepository.replaceGrants(id, forRole(role, grants));
        return id;
    }

    @Transactional("analyticsTxManager")
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

    /** An administrator issues a temporary password; the user must replace it at next login. */
    @Transactional("analyticsTxManager")
    public void changePassword(long id, String password) {
        validatePassword(password);
        require(id);
        userRepository.updatePassword(id, passwordEncoder.encode(password), true);
    }

    /** The account holder replaces their password, proving ownership with the current one. */
    @Transactional("analyticsTxManager")
    public void changeOwnPassword(long id, String currentPassword, String newPassword) {
        AppPrincipal me = require(id);
        if (currentPassword == null || !passwordEncoder.matches(currentPassword, me.getPassword())) {
            throw new IllegalArgumentException("Текущий пароль указан неверно");
        }
        validatePassword(newPassword);
        if (passwordEncoder.matches(newPassword, me.getPassword())) {
            throw new IllegalArgumentException("Новый пароль совпадает с текущим");
        }
        userRepository.updatePassword(id, passwordEncoder.encode(newPassword), false);
    }

    /**
     * Deleting yourself would end the very session doing it, and deleting the
     * last administrator would leave nobody able to manage accounts — the
     * bootstrap only runs on an empty table, so that state is permanent.
     */
    @Transactional("analyticsTxManager")
    public void delete(long id, long requestedBy) {
        if (id == requestedBy) {
            throw new IllegalArgumentException("Нельзя удалить собственную учётную запись");
        }
        AppPrincipal target = require(id);
        if (target.isAdmin() && target.isEnabled()) {
            requireAnotherAdmin(id);
        }
        userRepository.delete(id);
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

    private static void validatePassword(String password) {
        if (password == null || password.length() < MIN_PASSWORD_LENGTH) {
            throw new IllegalArgumentException("Пароль должен быть не короче " + MIN_PASSWORD_LENGTH + " символов");
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
}
