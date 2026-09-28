package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.support.SqlLoader;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Thanks count for closures only: every screen divides them by closed
 * tickets. Until 2026-09-28 a thanks after a rejection slipped into the
 * numerator, first fixed in the summary alone, so the operators page and the
 * drill-down disagreed with it.
 */
class ThankedRuleSqlTest {

    @ParameterizedTest
    @ValueSource(strings = {"summary", "operators", "ticket_details"})
    void thanksCountForClosuresOnly(String file) {
        String sql = SqlLoader.load("sql/" + file + ".sql");
        assertThat(sql).containsPattern("\\bthanked AND (\\w+\\.)?status = 'closed'");
        assertThat(sql).doesNotContainPattern("SUM\\((\\w+\\.)?thanked\\)");
    }
}
