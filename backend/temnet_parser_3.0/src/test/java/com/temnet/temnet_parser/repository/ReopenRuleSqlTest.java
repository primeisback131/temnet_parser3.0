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
    @ValueSource(strings = {"reopens", "help_account_reopens", "operators", "categories", "chat_tickets", "clients", "ticket_details"})
    void probableRepeatIsRefutedByTheLlmVerdict(String file) {
        String sql = SqlLoader.load("sql/" + file + ".sql");
        assertThat(sql).containsPattern("\\(\\w\\.reopen_score > 0 OR \\w\\.reopen_llm = 'same'\\)");
        assertThat(sql).containsPattern("COALESCE\\(\\w\\.reopen_llm, ''\\) <> 'new'");
    }

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
