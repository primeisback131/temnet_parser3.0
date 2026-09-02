-- Ticket resolution time (open -> closure) per group over the whole period,
-- in WORKING seconds, for the tickets one help account handled. Only
-- genuinely closed tickets; the cap trims mis-paired outliers.
SELECT DISTINCT
    group_name,
    COUNT(*)                OVER (PARTITION BY group_name) AS resolved,
    AVG(resolution_seconds) OVER (PARTITION BY group_name) AS avg_seconds,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY resolution_seconds) OVER (PARTITION BY group_name) AS p50_seconds,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY resolution_seconds) OVER (PARTITION BY group_name) AS p90_seconds
FROM (
    SELECT cg.grp AS group_name, t.resolution_seconds
    FROM ticket t
    JOIN client_group cg
      ON cg.client = t.client AND cg.grp NOT LIKE 'help%' AND cg.grp != 'all'
    WHERE t.account = :account
      AND t.closed_at >= :start AND t.closed_at < :endExclusive
      AND t.status = 'closed'
      AND t.resolution_seconds IS NOT NULL
      AND t.resolution_seconds <= :maxResolutionSeconds
) AS base
ORDER BY group_name
