-- First response time (FRT): for each inbound client request that starts a
-- new "burst" (i.e. the previous message was an operator reply or there was
-- none), measure the seconds until the next operator ("help") message in the
-- same conversation. Per time bucket we report the average plus the median
-- (p50) and 90th percentile (p90), which are robust to outliers.
--
-- Replies further away than :maxFrtSeconds are excluded as overnight /
-- cross-session gaps, so the numbers reflect in-session reaction time.
SELECT DISTINCT
    bucket,
    COUNT(*)         OVER (PARTITION BY bucket) AS responses,
    AVG(frt_seconds) OVER (PARTITION BY bucket) AS avg_seconds,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY frt_seconds) OVER (PARTITION BY bucket) AS p50_seconds,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY frt_seconds) OVER (PARTITION BY bucket) AS p90_seconds
FROM (
    SELECT
        ${bucket}   AS bucket,
        frt_seconds
    FROM (
        SELECT
            created_at,
            TIMESTAMPDIFF(SECOND, created_at, next_out) AS frt_seconds
        FROM (
            SELECT
                created_at,
                direction,
                LAG(direction) OVER w AS prev_direction,
                MIN(CASE WHEN direction = 'out' THEN created_at END)
                    OVER (PARTITION BY user_key ORDER BY created_at
                          ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING) AS next_out
            FROM (
                SELECT
                    created_at,
                    CASE WHEN username LIKE 'help%'
                         THEN SUBSTRING_INDEX(peer, '@', 1)
                         ELSE username END AS user_key,
                    CASE WHEN username LIKE 'help%' THEN 'out' ELSE 'in' END AS direction
                FROM archive
                WHERE created_at >= :start
                  AND created_at < :endExclusive
                  AND txt IS NOT NULL
                  AND txt != ' '
                  AND (peer LIKE 'help%' OR username LIKE 'help%')
                  ${groupFilter}
            ) AS classified
            WINDOW w AS (PARTITION BY user_key ORDER BY created_at)
        ) AS bursts
        WHERE direction = 'in'
          AND (prev_direction IS NULL OR prev_direction = 'out')
          AND next_out IS NOT NULL
    ) AS frt
    WHERE frt_seconds <= :maxFrtSeconds
) AS base
ORDER BY bucket
