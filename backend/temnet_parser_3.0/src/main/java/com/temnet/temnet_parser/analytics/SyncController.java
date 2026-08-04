package com.temnet.temnet_parser.analytics;

import com.temnet.temnet_parser.security.AccessControlService;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Manual control over the dump -> analytics sync (the scheduled job calls the
 * same service), used by the admin maintenance screen and by curl.
 * <p>
 * Both POSTs are fire-and-forget: a full rebuild runs for minutes, so they
 * answer with the run's initial state and the caller polls {@code /status}.
 * A second start while one is in flight is refused with 409.
 * <p>
 * The whole {@code /admin/**} tree is administrators-only (see SecurityConfig).
 */
@RestController
@RequestMapping("/admin/sync")
public class SyncController {

    private final AnalyticsSyncService syncService;
    private final AccessControlService accessControl;
    private final JdbcTemplate analytics;

    public SyncController(AnalyticsSyncService syncService,
                          AccessControlService accessControl,
                          @Qualifier("analyticsJdbcTemplate") JdbcTemplate analytics) {
        this.syncService = syncService;
        this.accessControl = accessControl;
        this.analytics = analytics;
    }

    /** Incremental sync from the current watermark. */
    @PostMapping
    public AnalyticsSyncService.SyncRun sync() {
        return start(false);
    }

    /** Drop everything and re-ingest the whole dump. */
    @PostMapping("/rebuild")
    public AnalyticsSyncService.SyncRun rebuild() {
        return start(true);
    }

    private AnalyticsSyncService.SyncRun start(boolean rebuild) {
        try {
            return syncService.startAsync(rebuild, accessControl.currentUser().getUsername());
        } catch (IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, e.getMessage());
        }
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        Map<String, Object> result = new HashMap<>(
                analytics.queryForMap("SELECT last_archive_id, last_run_at, messages_total FROM sync_state WHERE id = 1"));
        List<Map<String, Object>> tickets =
                analytics.queryForList("SELECT status, COUNT(*) AS count FROM ticket GROUP BY status");
        result.put("tickets", tickets);
        result.put("reopens", analytics.queryForObject(
                "SELECT COUNT(*) FROM ticket WHERE reopen_score > 0 OR reopen_llm = 'same'", Long.class));
        result.put("reopenLlm", analytics.queryForList(
                "SELECT reopen_llm AS verdict, COUNT(*) AS count FROM ticket"
                        + " WHERE reopen_llm IS NOT NULL GROUP BY reopen_llm"));
        // Current/last run — what the maintenance screen polls while a rebuild runs.
        result.put("run", syncService.lastRun());
        return result;
    }
}
