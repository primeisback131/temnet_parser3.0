package com.temnet.temnet_parser.analytics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Effective LLM settings: the environment's defaults overlaid with whatever
 * an administrator saved from the maintenance screen. Saved values live in
 * the {@code app_setting} table of the analytics DB under {@code llm.*} keys,
 * so they survive restarts and apply to the very next run without one.
 */
@Service
public class LlmSettingsService {

    private static final Logger log = LoggerFactory.getLogger(LlmSettingsService.class);

    private static final String PREFIX = "llm.";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_CATEGORIES = "categories";
    static final String KEY_MAX_PER_SYNC = "max-per-sync";
    static final String KEY_RPM = "requests-per-minute";
    static final String KEY_CEILING_IDLE = "ceiling-idle";
    static final String KEY_CEILING_BUSY = "ceiling-busy";
    static final String KEY_BUSY_WINDOW = "busy-window-minutes";
    static final String KEY_MODEL = "model";

    /** A saved override: value plus who saved it and when. */
    public record Override(String value, LocalDateTime updatedAt, String updatedBy) {
    }

    private final JdbcTemplate analytics;
    private final String providerKind;
    private final LlmSettings defaults;
    private volatile LlmSettings current;
    private volatile Map<String, Override> overrides = Map.of();

    public LlmSettingsService(
            @Qualifier("analyticsJdbcTemplate") JdbcTemplate analytics,
            @Value("${app.llm.provider:}") String provider,
            @Value("${app.llm.base-url:}") String baseUrl,
            @Value("${app.llm.model:}") String httpModel,
            @Value("${app.llm.claude-cli.model:claude-haiku-4-5}") String cliModel,
            @Value("${app.llm.categories:other}") String categories,
            @Value("${app.llm.max-per-sync:60}") int maxPerSync,
            @Value("${app.llm.requests-per-minute:0}") int requestsPerMinute,
            @Value("${app.llm.claude-cli.ceiling-idle:0.5}") double ceilingIdle,
            @Value("${app.llm.claude-cli.ceiling-busy:0.2}") double ceilingBusy,
            @Value("${app.llm.claude-cli.busy-window:PT10M}") Duration busyWindow) {
        this.analytics = analytics;
        this.providerKind = providerKind(provider, baseUrl);
        String model = "claude-cli".equals(providerKind) ? cliModel : httpModel;
        this.defaults = new LlmSettings(
                !"off".equals(providerKind),
                categories,
                maxPerSync,
                requestsPerMinute,
                ceilingIdle,
                ceilingBusy,
                (int) busyWindow.toMinutes(),
                model.isBlank() ? "-" : model);
    }

    /** {@code claude-cli}, {@code http} or {@code off}, resolved like {@link LlmChatConfig} does. */
    static String providerKind(String provider, String baseUrl) {
        String kind = provider == null ? "" : provider.strip().toLowerCase(Locale.ROOT);
        if (kind.isEmpty()) {
            return baseUrl == null || baseUrl.isBlank() ? "off" : "http";
        }
        return kind;
    }

    public String providerKind() {
        return providerKind;
    }

    /** What the environment configured, before any saved override. */
    public LlmSettings defaults() {
        return defaults;
    }

    /** The settings in force right now. */
    public LlmSettings current() {
        LlmSettings snapshot = current;
        if (snapshot == null) {
            reload();
            snapshot = current;
        }
        return snapshot;
    }

    /** Keys with a saved override, with who saved them and when. */
    public Map<String, Override> overrides() {
        current();
        return overrides;
    }

    /** Re-reads the saved overrides; an unreadable value is ignored with a warning. */
    public synchronized void reload() {
        Map<String, Override> found = new LinkedHashMap<>();
        analytics.query("SELECT name, value, updated_at, updated_by FROM app_setting WHERE name LIKE ?",
                rs -> {
                    Timestamp at = rs.getTimestamp("updated_at");
                    found.put(rs.getString("name").substring(PREFIX.length()),
                            new Override(rs.getString("value"), at == null ? null : at.toLocalDateTime(),
                                    rs.getString("updated_by")));
                },
                PREFIX + "%");
        current = overlay(defaults, found);
        overrides = Map.copyOf(found);
    }

    static LlmSettings overlay(LlmSettings base, Map<String, Override> saved) {
        LlmSettings result = base;
        try {
            result = new LlmSettings(
                    bool(saved, KEY_ENABLED, base.enabled()),
                    str(saved, KEY_CATEGORIES, base.categories()),
                    integer(saved, KEY_MAX_PER_SYNC, base.maxPerSync()),
                    integer(saved, KEY_RPM, base.requestsPerMinute()),
                    dbl(saved, KEY_CEILING_IDLE, base.ceilingIdle()),
                    dbl(saved, KEY_CEILING_BUSY, base.ceilingBusy()),
                    integer(saved, KEY_BUSY_WINDOW, base.busyWindowMinutes()),
                    str(saved, KEY_MODEL, base.model()));
        } catch (RuntimeException e) {
            log.warn("Saved LLM settings are invalid and ignored: {}", e.getMessage());
        }
        return result;
    }

    /** Saves every field as an override (a value equal to the default is saved too: it is what the admin chose). */
    public synchronized LlmSettings update(LlmSettings settings, String by) {
        Map<String, String> values = new LinkedHashMap<>();
        values.put(KEY_ENABLED, String.valueOf(settings.enabled()));
        values.put(KEY_CATEGORIES, settings.categories());
        values.put(KEY_MAX_PER_SYNC, String.valueOf(settings.maxPerSync()));
        values.put(KEY_RPM, String.valueOf(settings.requestsPerMinute()));
        values.put(KEY_CEILING_IDLE, String.valueOf(settings.ceilingIdle()));
        values.put(KEY_CEILING_BUSY, String.valueOf(settings.ceilingBusy()));
        values.put(KEY_BUSY_WINDOW, String.valueOf(settings.busyWindowMinutes()));
        values.put(KEY_MODEL, settings.model());
        for (Map.Entry<String, String> entry : values.entrySet()) {
            analytics.update("""
                            INSERT INTO app_setting (name, value, updated_by) VALUES (?, ?, ?)
                            ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)
                            """,
                    PREFIX + entry.getKey(), entry.getValue(), by);
        }
        reload();
        log.info("LLM settings saved by {}: {}", by, current);
        return current;
    }

    /** Drops every override; the environment's defaults apply again. */
    public synchronized LlmSettings reset(String by) {
        analytics.update("DELETE FROM app_setting WHERE name LIKE ?", PREFIX + "%");
        reload();
        log.info("LLM settings reset to the environment defaults by {}", by);
        return current;
    }

    /** Field names whose saved value differs from the default, for the screen. */
    public Set<String> overriddenKeys() {
        Set<String> keys = new TreeSet<>();
        LlmSettings now = current();
        LlmSettings base = defaults;
        if (now.enabled() != base.enabled()) keys.add(KEY_ENABLED);
        if (!now.categories().equals(base.categories())) keys.add(KEY_CATEGORIES);
        if (now.maxPerSync() != base.maxPerSync()) keys.add(KEY_MAX_PER_SYNC);
        if (now.requestsPerMinute() != base.requestsPerMinute()) keys.add(KEY_RPM);
        if (now.ceilingIdle() != base.ceilingIdle()) keys.add(KEY_CEILING_IDLE);
        if (now.ceilingBusy() != base.ceilingBusy()) keys.add(KEY_CEILING_BUSY);
        if (now.busyWindowMinutes() != base.busyWindowMinutes()) keys.add(KEY_BUSY_WINDOW);
        if (!now.model().equals(base.model())) keys.add(KEY_MODEL);
        return keys;
    }

    private static String str(Map<String, Override> saved, String key, String fallback) {
        Override o = saved.get(key);
        return o == null ? fallback : o.value();
    }

    private static boolean bool(Map<String, Override> saved, String key, boolean fallback) {
        Override o = saved.get(key);
        return o == null ? fallback : Boolean.parseBoolean(o.value());
    }

    private static int integer(Map<String, Override> saved, String key, int fallback) {
        Override o = saved.get(key);
        return o == null ? fallback : Integer.parseInt(o.value().strip());
    }

    private static double dbl(Map<String, Override> saved, String key, double fallback) {
        Override o = saved.get(key);
        return o == null ? fallback : Double.parseDouble(o.value().strip());
    }
}
