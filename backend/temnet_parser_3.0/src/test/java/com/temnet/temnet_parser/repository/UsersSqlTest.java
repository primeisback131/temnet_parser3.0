package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.support.SqlLoader;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The users report lists every member of the group, idle ones included, with
 * the time the account was last online. Before 2026-09-15 it filtered rows
 * to accounts with activity in the period, so stale accounts were invisible.
 */
class UsersSqlTest {

    @Test
    void listsEveryMemberWithLastSeen() {
        String sql = SqlLoader.load("sql/users.sql");
        assertThat(sql).contains("cg.last_seen_at");
        assertThat(sql).doesNotContain("msg.total > 0");
    }
}
