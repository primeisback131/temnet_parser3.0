package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.security.Scope;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The SQL fragments that enforce a scope. These are the access boundary of
 * every report, so each shape of grant is pinned here: an empty scope must
 * yield nothing, a desk must filter by itself, a group by the organization.
 */
class ScopeSqlTest {

    private static final String DENY_ALL = "AND 1 = 0";

    @Test
    void administratorIsOnlyKeptToRealGroups() {
        String messages = ScopeSql.messages("m", Scope.all());
        assertThat(messages).contains("cg_r.grp NOT LIKE 'help%'");
        assertThat(messages).doesNotContain(":scopeAccounts", ":scopeGroups", ":restrictGroup");
        assertThat(ScopeSql.tickets("t", Scope.all())).isEmpty();
    }

    @Test
    void emptyScopeMatchesNothing() {
        Scope nothing = Scope.of(List.of(), List.of());
        assertThat(nothing.isEmpty()).isTrue();
        assertThat(ScopeSql.messages("m", nothing)).isEqualTo(DENY_ALL);
        assertThat(ScopeSql.tickets("t", nothing)).isEqualTo(DENY_ALL);
    }

    @Test
    void deskGrantFiltersByTheDeskItself() {
        Scope desk = Scope.of(List.of("help-mag"), List.of());
        String messages = ScopeSql.messages("m", desk);
        assertThat(messages).contains("m.author IN (:scopeAccounts)", "m.recipient IN (:scopeAccounts)");
        assertThat(messages).doesNotContain(":scopeGroups");
        assertThat(ScopeSql.tickets("t", desk)).contains("t.account IN (:scopeAccounts)").doesNotContain(":scopeGroups");
    }

    @Test
    void groupGrantFiltersByTheOrganization() {
        Scope group = Scope.of(List.of(), List.of("CompanyA"));
        assertThat(ScopeSql.messages("m", group)).contains("cg_s.grp IN (:scopeGroups)").doesNotContain(":scopeAccounts");
        assertThat(ScopeSql.tickets("t", group)).contains("cg_s.grp IN (:scopeGroups)").doesNotContain(":scopeAccounts");
    }

    @Test
    void bothKindsOfGrantsAreCombinedWithOr() {
        Scope both = Scope.of(List.of("help"), List.of("CompanyB"));
        assertThat(ScopeSql.tickets("t", both))
                .contains("t.account IN (:scopeAccounts) OR EXISTS");
    }

    @Test
    void requestedGroupNarrowsOnTopOfTheGrants() {
        Scope narrowed = Scope.of(List.of("help"), List.of()).within("CompanyA");
        String tickets = ScopeSql.tickets("t", narrowed);
        assertThat(tickets).contains("cg_n.grp = :restrictGroup", "t.account IN (:scopeAccounts)");
        assertThat(ScopeSql.tickets("t", Scope.all().within("CompanyA"))).contains("cg_n.grp = :restrictGroup");
    }

    @Test
    void groupListingIsOpenForAdministratorsAndClosedForNobody() {
        assertThat(ScopeSql.groupList("cg.grp", List.of(), true)).isEmpty();
        assertThat(ScopeSql.groupList("cg.grp", List.of(), false)).isEqualTo(DENY_ALL);
        assertThat(ScopeSql.groupList("cg.grp", List.of("CompanyA"), false)).isEqualTo("AND cg.grp IN (:visibleGroups)");
    }
}
