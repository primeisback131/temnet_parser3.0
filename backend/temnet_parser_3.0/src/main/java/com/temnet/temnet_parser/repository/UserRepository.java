package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.Grant;
import com.temnet.temnet_parser.dto.HelpAccountScope;
import com.temnet.temnet_parser.dto.UserAccount;
import com.temnet.temnet_parser.security.AppPrincipal;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/** Application accounts and their grants (analytics DB). */
@Repository
public class UserRepository {

    private static final String PRINCIPAL_COLUMNS =
            "id, username, full_name, password_hash, role, enabled, must_change_password";

    private static final RowMapper<AppPrincipal> PRINCIPAL = (rs, i) -> new AppPrincipal(
            rs.getLong("id"),
            rs.getString("username"),
            rs.getString("full_name"),
            rs.getString("password_hash"),
            rs.getString("role"),
            rs.getBoolean("enabled"),
            rs.getBoolean("must_change_password"));

    private final JdbcClient jdbcClient;

    public UserRepository(@Qualifier("analyticsJdbcClient") JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public Optional<AppPrincipal> findPrincipal(String username) {
        return jdbcClient.sql("SELECT " + PRINCIPAL_COLUMNS + " FROM app_user WHERE username = :username")
                .param("username", username)
                .query(PRINCIPAL)
                .optional();
    }

    /** The live state of an account — what the per-request refresh compares the session against. */
    public Optional<AppPrincipal> findPrincipalById(long id) {
        return jdbcClient.sql("SELECT " + PRINCIPAL_COLUMNS + " FROM app_user WHERE id = :id")
                .param("id", id)
                .query(PRINCIPAL)
                .optional();
    }

    public long countUsers() {
        return jdbcClient.sql("SELECT COUNT(*) FROM app_user").query(Long.class).single();
    }

    /** Active administrators other than the given one — must never reach zero. */
    public long countEnabledAdminsExcluding(long id) {
        return jdbcClient.sql("SELECT COUNT(*) FROM app_user WHERE role = 'admin' AND enabled = 1 AND id <> :id")
                .param("id", id)
                .query(Long.class)
                .single();
    }

    public List<UserAccount> findAll() {
        List<UserAccount> users = jdbcClient.sql("""
                        SELECT id, username, full_name, role, enabled, must_change_password, created_at
                        FROM app_user ORDER BY username
                        """)
                .query((rs, i) -> new UserAccount(
                        rs.getLong("id"),
                        rs.getString("username"),
                        rs.getString("full_name"),
                        rs.getString("role"),
                        rs.getBoolean("enabled"),
                        rs.getBoolean("must_change_password"),
                        rs.getTimestamp("created_at").toLocalDateTime(),
                        List.of()))
                .list();

        Map<Long, List<Grant>> grants = jdbcClient.sql("""
                        SELECT user_id, scope_type, scope_value, can_metrics, can_chats
                        FROM user_grant ORDER BY scope_type, scope_value
                        """)
                .query((rs, i) -> Map.entry(
                        rs.getLong("user_id"),
                        new Grant(rs.getString("scope_type"), rs.getString("scope_value"),
                                rs.getBoolean("can_metrics"), rs.getBoolean("can_chats"))))
                .list().stream()
                .collect(Collectors.groupingBy(Map.Entry::getKey,
                        Collectors.mapping(Map.Entry::getValue, Collectors.toList())));

        return users.stream()
                .map(u -> new UserAccount(u.id(), u.username(), u.fullName(), u.role(), u.enabled(),
                        u.mustChangePassword(), u.createdAt(), grants.getOrDefault(u.id(), List.of())))
                .toList();
    }

    public long create(String username, String passwordHash, String fullName, String role, boolean enabled,
                       boolean mustChangePassword) {
        jdbcClient.sql("""
                        INSERT INTO app_user (username, password_hash, full_name, role, enabled, must_change_password)
                        VALUES (:username, :hash, :fullName, :role, :enabled, :mustChange)
                        """)
                .param("username", username)
                .param("hash", passwordHash)
                .param("fullName", fullName)
                .param("role", role)
                .param("enabled", enabled)
                .param("mustChange", mustChangePassword)
                .update();
        return jdbcClient.sql("SELECT id FROM app_user WHERE username = :username")
                .param("username", username).query(Long.class).single();
    }

    public void updateProfile(long id, String fullName, String role, boolean enabled) {
        jdbcClient.sql("UPDATE app_user SET full_name = :fullName, role = :role, enabled = :enabled WHERE id = :id")
                .param("fullName", fullName)
                .param("role", role)
                .param("enabled", enabled)
                .param("id", id)
                .update();
    }

    public void updatePassword(long id, String passwordHash, boolean mustChangePassword) {
        jdbcClient.sql("UPDATE app_user SET password_hash = :hash, must_change_password = :mustChange WHERE id = :id")
                .param("hash", passwordHash)
                .param("mustChange", mustChangePassword)
                .param("id", id)
                .update();
    }

    public void delete(long id) {
        jdbcClient.sql("DELETE FROM app_user WHERE id = :id").param("id", id).update();
    }

    public void replaceGrants(long userId, List<Grant> grants) {
        jdbcClient.sql("DELETE FROM user_grant WHERE user_id = :id").param("id", userId).update();
        for (Grant g : grants) {
            jdbcClient.sql("""
                            INSERT INTO user_grant (user_id, scope_type, scope_value, can_metrics, can_chats)
                            VALUES (:userId, :type, :value, :metrics, :chats)
                            """)
                    .param("userId", userId)
                    .param("type", g.scopeType())
                    .param("value", g.scopeValue())
                    .param("metrics", g.canMetrics())
                    .param("chats", g.canChats())
                    .update();
        }
    }

    /**
     * Client groups the user may see in the given area. Help-account grants
     * expand through help_account_group; group grants stand for themselves.
     * The area column is code-controlled (never user input).
     */
    public List<String> accessibleGroups(long userId, boolean chats) {
        String column = chats ? "can_chats" : "can_metrics";
        return jdbcClient.sql("""
                        SELECT DISTINCT grp FROM (
                            SELECT hag.grp AS grp
                            FROM user_grant ug
                            JOIN help_account_group hag ON hag.account = ug.scope_value
                            WHERE ug.user_id = :userId AND ug.scope_type = 'help_account' AND ug.%s = 1
                            UNION
                            SELECT ug.scope_value
                            FROM user_grant ug
                            WHERE ug.user_id = :userId AND ug.scope_type = 'group' AND ug.%s = 1
                        ) AS g
                        ORDER BY grp
                        """.formatted(column, column))
                .param("userId", userId)
                .query(String.class)
                .list();
    }

    /**
     * Help accounts granted for the given area. These ARE the desk filter:
     * data is limited to messages and tickets of these accounts, not to the
     * organizations they happen to serve.
     */
    public List<String> accessibleAccounts(long userId, boolean chats) {
        return grantValues(userId, Grant.HELP_ACCOUNT, chats);
    }

    /** Individually granted groups — whole organizations, whoever handled them. */
    public List<String> accessibleOwnGroups(long userId, boolean chats) {
        return grantValues(userId, Grant.GROUP, chats);
    }

    /** The area column is code-controlled (never user input). */
    private List<String> grantValues(long userId, String scopeType, boolean chats) {
        String column = chats ? "can_chats" : "can_metrics";
        return jdbcClient.sql(("SELECT scope_value FROM user_grant WHERE user_id = :userId"
                        + " AND scope_type = :scopeType AND %s = 1 ORDER BY scope_value").formatted(column))
                .param("userId", userId)
                .param("scopeType", scopeType)
                .query(String.class)
                .list();
    }

    /** Help accounts the user may report on (metrics area). */
    public List<String> accessibleHelpAccounts(long userId) {
        return jdbcClient.sql("""
                        SELECT scope_value FROM user_grant
                        WHERE user_id = :userId AND scope_type = 'help_account' AND can_metrics = 1
                        ORDER BY scope_value
                        """)
                .param("userId", userId)
                .query(String.class)
                .list();
    }

    /** Every help account with the groups it expands to — the granting picker. */
    public List<HelpAccountScope> allHelpAccounts() {
        Map<String, List<String>> byAccount = new LinkedHashMap<>();
        jdbcClient.sql("SELECT account, grp FROM help_account_group ORDER BY account, grp")
                .query((rs, i) -> Map.entry(rs.getString("account"), rs.getString("grp")))
                .list()
                .forEach(e -> byAccount.computeIfAbsent(e.getKey(), k -> new ArrayList<>()).add(e.getValue()));
        return byAccount.entrySet().stream()
                .map(e -> new HelpAccountScope(e.getKey(), e.getValue()))
                .toList();
    }
}
