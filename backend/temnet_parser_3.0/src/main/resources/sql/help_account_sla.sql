-- First-response time per group over the whole period, for the tickets one
-- help account handled (frt_seconds is WORKING seconds, precomputed at
-- ingest; the cap drops mis-paired outliers). ticket.account keeps another
-- desk's tickets with the same clients out of this desk's report.
SELECT DISTINCT
    group_name,
    COUNT(*)         OVER (PARTITION BY group_name) AS responses,
    AVG(frt_seconds) OVER (PARTITION BY group_name) AS avg_seconds,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY frt_seconds) OVER (PARTITION BY group_name) AS p50_seconds,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY frt_seconds) OVER (PARTITION BY group_name) AS p90_seconds
FROM (
    SELECT cg.grp AS group_name, t.frt_seconds
    FROM ticket t
    JOIN client_group cg
      ON cg.client = t.client AND cg.grp NOT LIKE 'help%' AND cg.grp != 'all'
    WHERE t.account = :account
      AND t.opened_at >= :start AND t.opened_at < :endExclusive
      AND t.frt_seconds IS NOT NULL
      AND t.frt_seconds <= :maxFrtSeconds
) AS base
ORDER BY group_name
