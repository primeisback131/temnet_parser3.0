package com.temnet.temnet_parser.analytics;

import com.temnet.temnet_parser.security.AccessControlService;
import com.temnet.temnet_parser.support.CategoryRules;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The LLM step as seen from the maintenance screen: what the provider is and
 * how it is doing, how much is classified and how much is waiting, the last
 * runs, and the runtime settings — readable and writable. Administrators
 * only, like the rest of {@code /admin/**}.
 */
@RestController
@RequestMapping("/admin/llm")
public class LlmAdminController {

    private final LlmChat chat;
    private final LlmSettingsService settings;
    private final LlmRunStats stats;
    private final AnalyticsSyncService syncService;
    private final AccessControlService accessControl;
    private final JdbcTemplate analytics;
    private final Duration syncInterval;

    public LlmAdminController(LlmChat chat,
                              LlmSettingsService settings,
                              LlmRunStats stats,
                              AnalyticsSyncService syncService,
                              AccessControlService accessControl,
                              @Qualifier("analyticsJdbcTemplate") JdbcTemplate analytics,
                              @Value("${app.sync.interval:PT5M}") Duration syncInterval) {
        this.chat = chat;
        this.settings = settings;
        this.stats = stats;
        this.syncService = syncService;
        this.accessControl = accessControl;
        this.analytics = analytics;
        this.syncInterval = syncInterval;
    }

    @GetMapping
    public Map<String, Object> status() {
        Map<String, Object> result = new LinkedHashMap<>();
        Map<String, Object> provider = new LinkedHashMap<>();
        provider.put("kind", chat.kind());
        provider.put("configured", chat.enabled());
        provider.put("description", chat.describe());
        result.put("provider", provider);
        result.put("settings", settings.current());
        result.put("defaults", settings.defaults());
        result.put("overriddenKeys", settings.overriddenKeys());
        result.put("overrides", settings.overrides());
        result.put("telemetry", chat.enabled() ? chat.telemetry() : Map.of());
        result.put("stats", stats.snapshot());
        result.put("counters", counters());
        result.put("syncIntervalSeconds", syncInterval.toSeconds());
        result.put("run", syncService.lastRun());
        return result;
    }

    /** Saves the settings; they apply to the next run. Validation errors come back as 400. */
    @PutMapping("/settings")
    public LlmSettings update(@RequestBody LlmSettings body) {
        return settings.update(body, accessControl.currentUser().getUsername());
    }

    /** Drops the saved overrides so the environment's values apply again. */
    @DeleteMapping("/settings")
    public LlmSettings reset() {
        return settings.reset(accessControl.currentUser().getUsername());
    }

    /** Runs only the classifiers, now, without a dump sync. Refused with 409 while a run is in flight. */
    @PostMapping("/run")
    public AnalyticsSyncService.SyncRun run() {
        try {
            return syncService.startClassificationAsync(accessControl.currentUser().getUsername());
        } catch (IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, e.getMessage());
        }
    }

    /** How much is decided and how much waits, for both classifiers. */
    private Map<String, Object> counters() {
        Map<String, Object> reopens = new LinkedHashMap<>();
        reopens.put("pending", 0L);
        reopens.put("same", 0L);
        reopens.put("new", 0L);
        analytics.query("SELECT reopen_llm AS verdict, COUNT(*) AS count FROM ticket"
                        + " WHERE reopen_llm IS NOT NULL GROUP BY reopen_llm",
                rs -> {
                    reopens.put(rs.getString("verdict"), rs.getLong("count"));
                });
        reopens.put("heuristic", analytics.queryForObject(
                "SELECT COUNT(*) FROM ticket WHERE reopen_score > 0", Long.class));

        LlmCategoryClassifier.Mode mode = LlmCategoryClassifier.parseMode(settings.current().categories());
        String modeFilter = LlmCategoryClassifier.modeFilter(mode);
        Map<String, Object> categories = new LinkedHashMap<>();
        categories.put("mode", mode.name().toLowerCase());
        categories.put("pending", mode == LlmCategoryClassifier.Mode.OFF ? 0L : analytics.queryForObject("""
                        SELECT COUNT(*) FROM ticket t
                        LEFT JOIN llm_category c ON c.client = t.client AND c.opened_at = t.opened_at
                        WHERE c.client IS NULL AND %s %s
                        """.formatted(LlmCategoryClassifier.FINISHED, modeFilter), Long.class));
        categories.put("openOther", analytics.queryForObject(
                "SELECT COUNT(*) FROM ticket t WHERE t.status = 'open' AND t.stale_at >= NOW()"
                        + " AND t.category_rank = " + CategoryRules.otherRank(), Long.class));
        categories.put("otherTotal", analytics.queryForObject(
                "SELECT COUNT(*) FROM ticket WHERE category_rank = " + CategoryRules.otherRank(), Long.class));
        categories.put("ticketsTotal", analytics.queryForObject("SELECT COUNT(*) FROM ticket", Long.class));
        categories.put("classified", analytics.queryForObject("SELECT COUNT(*) FROM llm_category", Long.class));
        List<Map<String, Object>> byCategory = analytics.queryForList(
                "SELECT category, COUNT(*) AS count FROM llm_category GROUP BY category ORDER BY count DESC");
        categories.put("byCategory", byCategory);

        Map<String, Object> counters = new LinkedHashMap<>();
        counters.put("reopens", reopens);
        counters.put("categories", categories);
        return counters;
    }
}
