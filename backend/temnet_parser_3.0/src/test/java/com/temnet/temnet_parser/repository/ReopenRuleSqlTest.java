package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.support.SqlLoader;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

class ReopenRuleSqlTest {

    /**
     * "The client came back" counts only a repeat the caller may see: a desk
     * sees repeats on itself, not on another desk (2026-09-28, the flag and
     * the operators' count looked at every desk).
     */
    @ParameterizedTest
    @ValueSource(strings = {"operators", "ticket_details"})
    void repeatIsLookedUpInTheCallersScope(String file) {
        String sql = SqlLoader.load("sql/" + file + ".sql");
        assertThat(sql).containsPattern("(?s)reopened_from = \\w+\\.id.{0,300}\\$\\{reopenScope\\}");
    }
}
