package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.support.SqlLoader;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The "probable repeat" rule is copied into every report that mentions
 * reopens. Each copy must let an LLM verdict of "new" take the ticket off
 * the charts: before 2026-09-10 a bare category match (reopen_score = 1)
 * never reached the model and stayed "probable" forever.
 */
class ReopenRuleSqlTest {

    @ParameterizedTest
    @ValueSource(strings = {"reopens", "help_account_reopens", "operators", "categories", "chat_tickets", "clients"})
    void probableRepeatIsRefutedByTheLlmVerdict(String file) {
        String sql = SqlLoader.load("sql/" + file + ".sql");
        assertThat(sql).containsPattern("\\(\\w\\.reopen_score > 0 OR \\w\\.reopen_llm = 'same'\\)");
        assertThat(sql).containsPattern("COALESCE\\(\\w\\.reopen_llm, ''\\) <> 'new'");
    }
}
