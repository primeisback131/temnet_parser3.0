package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.security.Scope;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * SQL fragments that enforce a {@link Scope}. One place, so metrics and reports
 * cannot answer the same question differently.
 * <p>
 * Access granted per help account filters by the DESK — {@code author}/
 * {@code recipient} on messages, {@code ticket.account} on tickets — never by
 * the organizations that desk happens to serve. Two desks can work the same
 * organization and even the same client; neither may see the other's work.
 * Individually granted groups are the exception: there the whole organization
 * is meant, whoever handled it.
 */
public final class ScopeSql {

    /** A scope granting nothing must return nothing — never "everything". */
    private static final String DENY_ALL = "AND 1 = 0";

    private ScopeSql() {
    }

    /** Filter for message rows, including the "real company group" guard. */
    public static String messages(String alias, Scope scope) {
        if (scope.isEmpty()) {
            return DENY_ALL;
        }
        String inRealGroup = "AND EXISTS (SELECT 1 FROM client_group cg_r WHERE cg_r.client = " + alias
                + ".client AND cg_r.grp NOT LIKE 'help%' AND cg_r.grp <> 'all')";
        if (scope.unrestricted()) {
            return inRealGroup + narrow(alias, scope);
        }
        return inRealGroup + narrow(alias, scope) + " AND (" + either(
                "(" + alias + ".author IN (:scopeAccounts) OR " + alias + ".recipient IN (:scopeAccounts))",
                inGroups(alias, "cg_s"),
                scope) + ")";
    }

    /** Filter for ticket rows. */
    public static String tickets(String alias, Scope scope) {
        if (scope.isEmpty()) {
            return DENY_ALL;
        }
        if (scope.unrestricted()) {
            return narrow(alias, scope);
        }
        return narrow(alias, scope) + " AND ("
                + either(alias + ".account IN (:scopeAccounts)", inGroups(alias, "cg_s"), scope) + ")";
    }

    /** Restricts a group listing to the groups the caller may see at all. */
    public static String groupList(String column, java.util.List<String> visibleGroups, boolean unrestricted) {
        if (unrestricted) {
            return "";
        }
        return visibleGroups.isEmpty() ? DENY_ALL : "AND " + column + " IN (:visibleGroups)";
    }

    public static JdbcClient.StatementSpec bind(JdbcClient.StatementSpec spec, Scope scope) {
        if (scope.hasAccounts()) {
            spec = spec.param("scopeAccounts", scope.accounts());
        }
        if (scope.hasGroups()) {
            spec = spec.param("scopeGroups", scope.groups());
        }
        if (scope.hasRestrictGroup()) {
            spec = spec.param("restrictGroup", scope.restrictGroup());
        }
        return spec;
    }

    /** The one group the request asked for, ANDed on top of the grants. */
    private static String narrow(String alias, Scope scope) {
        if (!scope.hasRestrictGroup()) {
            return "";
        }
        return " AND EXISTS (SELECT 1 FROM client_group cg_n WHERE cg_n.client = " + alias
                + ".client AND cg_n.grp = :restrictGroup)";
    }

    private static String inGroups(String alias, String cgAlias) {
        return "EXISTS (SELECT 1 FROM client_group " + cgAlias + " WHERE " + cgAlias + ".client = " + alias
                + ".client AND " + cgAlias + ".grp IN (:scopeGroups))";
    }

    /** Keeps only the halves actually granted, so no unbound parameter is left. */
    private static String either(String byAccount, String byGroup, Scope scope) {
        if (scope.hasAccounts() && scope.hasGroups()) {
            return byAccount + " OR " + byGroup;
        }
        return scope.hasAccounts() ? byAccount : byGroup;
    }
}
