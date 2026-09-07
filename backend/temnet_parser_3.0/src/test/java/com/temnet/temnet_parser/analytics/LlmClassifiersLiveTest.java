package com.temnet.temnet_parser.analytics;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Runs both classifiers against the real analytics database through the real
 * Claude Code CLI: two calls each, results written to the database exactly as
 * a sync run would. Off by default: needs {@code CLAUDE_CLI_LIVE=1}, a
 * reachable MariaDB with the analytics schema, and {@code claude auth login}.
 * Connection: ANALYTICS_DB_URL / ANALYTICS_DB_USER / ANALYTICS_DB_PASSWORD
 * with the application's defaults.
 */
@EnabledIfEnvironmentVariable(named = "CLAUDE_CLI_LIVE", matches = "1")
class LlmClassifiersLiveTest {

    private static JdbcTemplate analytics() {
        DriverManagerDataSource ds = new DriverManagerDataSource();
        ds.setUrl(env("ANALYTICS_DB_URL", "jdbc:mariadb://localhost:3306/temnet_analytics"));
        ds.setUsername(env("ANALYTICS_DB_USER", "root"));
        ds.setPassword(env("ANALYTICS_DB_PASSWORD", "root"));
        return new JdbcTemplate(ds);
    }

    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    @Test
    void classifiersWriteRealVerdictsThroughTheCli(@TempDir Path dir) {
        JdbcTemplate analytics = analytics();
        analytics.execute("CREATE TABLE IF NOT EXISTS llm_category ("
                + "client VARCHAR(191) NOT NULL, opened_at DATETIME NOT NULL, category VARCHAR(64) NOT NULL,"
                + " PRIMARY KEY (client, opened_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        analytics.execute("CREATE TABLE IF NOT EXISTS app_setting ("
                + "name VARCHAR(64) NOT NULL PRIMARY KEY, value VARCHAR(255) NOT NULL,"
                + " updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,"
                + " updated_by VARCHAR(191) NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Environment-like defaults; whatever the admin saved in app_setting overlays them.
        LlmSettingsService settings = new LlmSettingsService(analytics, "claude-cli", "", "", "claude-haiku-4-5",
                "other", 60, 0, 1.0, 1.0, Duration.ofMinutes(10));
        LlmRunStats stats = new LlmRunStats();
        ClaudeCliChat chat = new ClaudeCliChat(new ClaudeCliChat.Settings("claude", dir,
                Path.of(System.getProperty("user.home"), ".claude"), Duration.ofMinutes(2)), settings::current);

        long verdictsBefore = count(analytics, "llm_verdict");
        long categoriesBefore = count(analytics, "llm_category");
        long pendingReopens = analytics.queryForObject(
                "SELECT COUNT(*) FROM ticket WHERE reopen_llm = 'pending'", Long.class);

        LlmReopenClassifier.Result reopens = new LlmReopenClassifier(analytics, chat, stats, 2).classifyPending(2);
        LlmCategoryClassifier.Result categories =
                new LlmCategoryClassifier(analytics, chat, settings, stats, 2).classifyPending(2);

        if (pendingReopens > 0) {
            assertEquals(2, reopens.decided(), "two pending reopen candidates should be decided: "
                    + stats.snapshot().reopens());
            assertEquals(verdictsBefore + 2, count(analytics, "llm_verdict"));
        }
        assertEquals(2, categories.decided(), "two finished «Другое» tickets should be categorized: "
                + stats.snapshot().categories());
        assertEquals(categoriesBefore + 2, count(analytics, "llm_category"));

        List<Map<String, Object>> latest = analytics.queryForList(
                "SELECT c.category, t.category AS ticket_category FROM llm_category c"
                        + " JOIN ticket t ON t.client = c.client AND t.opened_at = c.opened_at"
                        + " ORDER BY t.id DESC LIMIT 2");
        for (Map<String, Object> row : latest) {
            assertEquals(row.get("category"), row.get("ticket_category"),
                    "the ticket carries the category the model named");
        }
        LlmRunStats.Snapshot snapshot = stats.snapshot();
        assertEquals(4, snapshot.totalCalls());
        assertNotNull(snapshot.averageCallMillis());
        assertTrue(chat.usageSummary().contains("%"), chat.usageSummary());
        System.out.println("Live run: reopens " + reopens + ", categories " + categories + ", "
                + chat.usageSummary() + ", avg call " + snapshot.averageCallMillis() + " ms");
    }

    private static long count(JdbcTemplate analytics, String table) {
        return analytics.queryForObject("SELECT COUNT(*) FROM " + table, Long.class);
    }
}
