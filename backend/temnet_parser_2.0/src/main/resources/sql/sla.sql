-- First response time (FRT): for each inbound client request that starts a
-- new "burst" (i.e. the previous message was an operator reply or there was
-- none), measure the seconds until the next operator ("help") message in the
-- same conversation. Aggregated as average per time bucket.
--
-- Replies further away than :maxFrtSeconds are excluded as overnight /
-- cross-session gaps, so the average reflects in-session reaction time.
SELECT
    ${bucket}            AS bucket,
    COUNT(*)             AS responses,
    AVG(frt_seconds)     AS avg_seconds
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
                CASE WHEN username LIKE '%help%'
                     THEN SUBSTRING_INDEX(peer, '@', 1)
                     ELSE username END AS user_key,
                CASE WHEN username LIKE '%help%' THEN 'out' ELSE 'in' END AS direction
            FROM archive
            WHERE created_at >= :start
              AND created_at < :endExclusive
              AND txt IS NOT NULL
              AND txt != ' '
              AND (peer LIKE '%help%' OR username LIKE '%help%')
              ${groupFilter}
        ) AS classified
        WINDOW w AS (PARTITION BY user_key ORDER BY created_at)
    ) AS bursts
    WHERE direction = 'in'
      AND (prev_direction IS NULL OR prev_direction = 'out')
      AND next_out IS NOT NULL
) AS frt
WHERE frt_seconds <= :maxFrtSeconds
GROUP BY bucket
ORDER BY bucket
