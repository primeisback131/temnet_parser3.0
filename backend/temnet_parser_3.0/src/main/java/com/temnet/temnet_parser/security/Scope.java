package com.temnet.temnet_parser.security;

import java.util.List;

/**
 * What a single request is allowed to see.
 * <p>
 * Two independent sources, combined with OR:
 * <ul>
 *   <li>{@code accounts} — granted help accounts. Data is filtered by the DESK
 *       itself (message author/recipient, {@code ticket.account}), not by the
 *       organizations it serves: two desks can work the same organization, even
 *       the same client, and neither may see the other's work.</li>
 *   <li>{@code groups} — individually granted client groups, where the whole
 *       organization is meant regardless of which desk handled it.</li>
 * </ul>
 * {@code unrestricted} is an administrator: everything, including data that
 * arrives later.
 * <p>
 * A record so it can serve as part of a cache key: users with identical scopes
 * share cached results. An EMPTY scope (no accounts, no groups) is meaningful
 * and must yield no rows — never "everything".
 */
public record Scope(boolean unrestricted, List<String> accounts, List<String> groups, String restrictGroup) {

    private static final Scope ALL = new Scope(true, List.of(), List.of(), null);

    /** Administrator scope: no restriction at all. */
    public static Scope all() {
        return ALL;
    }

    public static Scope of(List<String> accounts, List<String> groups) {
        return new Scope(false, List.copyOf(accounts), List.copyOf(groups), null);
    }

    /**
     * The same permissions, narrowed to one requested group. It ANDs with the
     * grants: asking for a group never widens what a desk may see inside it.
     */
    public Scope within(String group) {
        return new Scope(unrestricted, accounts, groups, group);
    }

    /** A scope restricted to specific groups only (no desk filter). */
    public static Scope ofGroups(List<String> groups) {
        return of(List.of(), groups);
    }

    public boolean hasAccounts() {
        return !unrestricted && !accounts.isEmpty();
    }

    public boolean hasGroups() {
        return !unrestricted && !groups.isEmpty();
    }

    public boolean hasRestrictGroup() {
        return restrictGroup != null && !restrictGroup.isBlank();
    }

    /** True when the scope cannot match anything — the query must return nothing. */
    public boolean isEmpty() {
        return !unrestricted && accounts.isEmpty() && groups.isEmpty();
    }
}
