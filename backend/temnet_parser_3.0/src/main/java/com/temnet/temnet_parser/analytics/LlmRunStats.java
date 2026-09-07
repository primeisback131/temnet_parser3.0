package com.temnet.temnet_parser.analytics;

import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * What the LLM step did lately, for the maintenance screen: the last run of
 * each classifier (decisions, calls, why it stopped) and totals since the
 * application started. In memory on purpose — the durable record is the
 * verdict tables themselves.
 */
@Service
public class LlmRunStats {

    /** One classifier's last run. */
    public record Step(LocalDateTime at, int decided, int calls, String pausedReason, String error) {
    }

    /** A point-in-time copy for the API. */
    public record Snapshot(
            LocalDateTime lastRunAt,
            Step reopens,
            Step categories,
            long totalCalls,
            long totalReopensDecided,
            long totalCategoriesDecided,
            Long averageCallMillis,
            LocalDateTime lastCallAt) {
    }

    private LocalDateTime lastRunAt;
    private Step reopens;
    private Step categories;
    private long totalCalls;
    private long totalReopensDecided;
    private long totalCategoriesDecided;
    private long callMillisTotal;
    private LocalDateTime lastCallAt;

    public synchronized void recordReopens(int decided, int calls, String pausedReason, String error) {
        lastRunAt = LocalDateTime.now();
        reopens = new Step(lastRunAt, decided, calls, pausedReason, error);
        totalReopensDecided += decided;
    }

    public synchronized void recordCategories(int decided, int calls, String pausedReason, String error) {
        lastRunAt = LocalDateTime.now();
        categories = new Step(lastRunAt, decided, calls, pausedReason, error);
        totalCategoriesDecided += decided;
    }

    /** One provider call took this long. */
    public synchronized void recordCall(long millis) {
        totalCalls++;
        callMillisTotal += millis;
        lastCallAt = LocalDateTime.now();
    }

    public synchronized Snapshot snapshot() {
        return new Snapshot(lastRunAt, reopens, categories, totalCalls, totalReopensDecided,
                totalCategoriesDecided, totalCalls == 0 ? null : callMillisTotal / totalCalls, lastCallAt);
    }
}
