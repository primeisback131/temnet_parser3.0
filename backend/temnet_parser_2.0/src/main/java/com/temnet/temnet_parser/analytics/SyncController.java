package com.temnet.temnet_parser.analytics;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Manual control over the dump -> analytics sync (the scheduled job calls the
 * same service). POST endpoints are meant for curl/scripts, e.g. right after
 * a new dump has been imported.
 */
@RestController
@RequestMapping("/admin/sync")
public class SyncController {

    private final AnalyticsSyncService syncService;
    private final JdbcTemplate analytics;

    public SyncController(AnalyticsSyncService syncService,
                          @Qualifier("analyticsJdbcTemplate") JdbcTemplate analytics) {
        this.syncService = syncService;
        this.analytics = analytics;
    }

    /** Incremental sync from the current watermark. */
    @PostMapping
    public AnalyticsSyncService.SyncSummary sync() {
        return syncService.sync(false);
    }

    /** Drop everything and re-ingest the whole dump. */
    @PostMapping("/rebuild")
    public AnalyticsSyncService.SyncSummary rebuild() {
        return syncService.sync(true);
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        Map<String, Object> result = new HashMap<>(
                analytics.queryForMap("SELECT last_archive_id, last_run_at, messages_total FROM sync_state WHERE id = 1"));
        List<Map<String, Object>> tickets =
                analytics.queryForList("SELECT status, COUNT(*) AS count FROM ticket GROUP BY status");
        result.put("tickets", tickets);
        result.put("reopens", analytics.queryForObject(
                "SELECT COUNT(*) FROM ticket WHERE reopen_score > 0", Long.class));
        return result;
    }
}
