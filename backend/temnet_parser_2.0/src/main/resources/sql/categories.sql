-- Classify each client REQUEST into a problem category, then count per
-- category. A request = a conversation "session": a client's messages grouped
-- so that a pause longer than :sessionGapSeconds starts a new session. This
-- matches a support ticket far better than counting every message (a single
-- ticket has many back-and-forth turns). The category is the highest-priority
-- keyword match across all the client's messages in the session.
SELECT
    ${rankToName} AS category,
    COUNT(*)      AS requests
FROM (
    SELECT MIN(cat_rank) AS min_rank
    FROM (
        SELECT
            user_key,
            direction,
            ${rankCase} AS cat_rank,
            SUM(is_start) OVER (PARTITION BY user_key ORDER BY created_at) AS session_id
        FROM (
            SELECT
                created_at,
                txt,
                user_key,
                direction,
                CASE WHEN LAG(created_at) OVER w IS NULL
                       OR business_seconds(LAG(created_at) OVER w, created_at) > :sessionGapSeconds
                     THEN 1 ELSE 0 END AS is_start
            FROM (
                SELECT
                    created_at,
                    txt,
                    CASE WHEN username LIKE 'help%' THEN SUBSTRING_INDEX(peer, '@', 1) ELSE username END AS user_key,
                    CASE WHEN username LIKE 'help%' THEN 'out' ELSE 'in' END AS direction
                FROM archive
                WHERE created_at >= :start
                  AND created_at < :endExclusive
                  AND txt IS NOT NULL
                  AND txt != ' '
                  AND (username LIKE 'help%' OR peer LIKE 'help%')
            ) AS base
            WINDOW w AS (PARTITION BY user_key ORDER BY created_at)
        ) AS flagged
    ) AS sessioned
    WHERE direction = 'in'
      ${groupFilter}
    GROUP BY user_key, session_id
) AS per_session
GROUP BY category
ORDER BY requests DESC
