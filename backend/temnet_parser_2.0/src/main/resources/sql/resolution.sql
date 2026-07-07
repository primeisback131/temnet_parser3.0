-- Ticket resolution time (open -> closure) per bucket, in WORKING seconds
-- (resolution_seconds precomputed at ingest). Only genuinely closed tickets;
-- the cap trims mis-paired outliers from the percentiles. ${anchor} is
-- closed_at shifted off weekends to the next Monday: weekends are
-- non-working, so weekend closures land on the nearest working day.
SELECT DISTINCT
    bucket,
    COUNT(*)                OVER (PARTITION BY bucket) AS resolved,
    AVG(resolution_seconds) OVER (PARTITION BY bucket) AS avg_seconds,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY resolution_seconds) OVER (PARTITION BY bucket) AS p50_seconds,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY resolution_seconds) OVER (PARTITION BY bucket) AS p90_seconds
FROM (
    SELECT ${bucket} AS bucket, t.resolution_seconds
    FROM ticket t
    WHERE ${anchor} >= :start AND ${anchor} < :endExclusive
      AND t.status = 'closed'
      AND t.resolution_seconds IS NOT NULL
      AND t.resolution_seconds <= :maxResolutionSeconds
      ${groupFilter}
) AS base
ORDER BY bucket
