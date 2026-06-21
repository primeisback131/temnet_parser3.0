-- Classify each client REQUEST into a problem category, then count per
-- category. A request = one inbound "burst" (the client's consecutive messages
-- until the operator replies). The category is the highest-priority keyword
-- match across ALL the client's messages in that burst, so an opening greeting
-- followed by the actual problem is classified correctly.
SELECT
    ${rankToName} AS category,
    COUNT(*)      AS requests
FROM (
    SELECT MIN(cat_rank) AS min_rank
    FROM (
        SELECT
            user_key,
            direction,
            SUM(is_start) OVER (PARTITION BY user_key ORDER BY created_at) AS burst_id,
            ${rankCase} AS cat_rank
        FROM (
            SELECT
                created_at,
                txt,
                user_key,
                direction,
                CASE WHEN direction = 'in' AND (prev_direction IS NULL OR prev_direction = 'out')
                     THEN 1 ELSE 0 END AS is_start
            FROM (
                SELECT
                    created_at,
                    txt,
                    CASE WHEN username LIKE '%help%' THEN SUBSTRING_INDEX(peer, '@', 1) ELSE username END AS user_key,
                    CASE WHEN username LIKE '%help%' THEN 'out' ELSE 'in' END AS direction,
                    LAG(CASE WHEN username LIKE '%help%' THEN 'out' ELSE 'in' END)
                        OVER (PARTITION BY CASE WHEN username LIKE '%help%' THEN SUBSTRING_INDEX(peer, '@', 1) ELSE username END
                              ORDER BY created_at) AS prev_direction
                FROM archive
                WHERE created_at >= :start
                  AND created_at < :endExclusive
                  AND txt IS NOT NULL
                  AND txt != ' '
                  AND (peer LIKE '%help%' OR username LIKE '%help%')
            ) AS base
        ) AS flagged
    ) AS bursts
    WHERE direction = 'in'
      ${groupFilter}
    GROUP BY user_key, burst_id
) AS per_request
GROUP BY category
ORDER BY requests DESC
