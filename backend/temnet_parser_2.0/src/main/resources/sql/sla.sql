-- First-response time per bucket, straight from precomputed ticket columns
-- (frt_seconds is WORKING seconds, computed by the ingest state machine).
SELECT DISTINCT
    bucket,
    COUNT(*)         OVER (PARTITION BY bucket) AS responses,
    AVG(frt_seconds) OVER (PARTITION BY bucket) AS avg_seconds,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY frt_seconds) OVER (PARTITION BY bucket) AS p50_seconds,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY frt_seconds) OVER (PARTITION BY bucket) AS p90_seconds
FROM (
    SELECT ${bucket} AS bucket, t.frt_seconds
    FROM ticket t
    WHERE t.opened_at >= :start AND t.opened_at < :endExclusive
      AND t.frt_seconds IS NOT NULL
      AND t.frt_seconds <= :maxFrtSeconds
      ${groupFilter}
) AS base
ORDER BY bucket
