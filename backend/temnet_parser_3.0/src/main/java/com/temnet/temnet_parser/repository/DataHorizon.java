package com.temnet.temnet_parser.repository;

/**
 * The period end capped at the data horizon — the freshest ingested message,
 * plus one second so the boundary stays exclusive like the midnight one it
 * replaces.
 * <p>
 * Every "still open at the end" figure must use this. Past the horizon no
 * messages arrive, so each open ticket goes stale within 20 working hours and
 * an uncapped count collapses to 0 — which reads as "nothing open" instead of
 * "nothing known". Shared by /metrics/backlog, the timeseries and the company
 * and user reports so the same period cannot produce two different answers.
 */
public final class DataHorizon {

    public static final String CAPPED_END =
            "COALESCE(LEAST(:endExclusive, (SELECT MAX(created_at) + INTERVAL 1 SECOND FROM message)),"
                    + " :endExclusive)";

    private DataHorizon() {
    }
}
