-- First response time (FRT) — ONE value per ticket (request), not per message.
--
-- A ticket starts with a client message that opens a new conversation session:
-- either there is no previous message, or the pause since the previous message
-- exceeds :sessionGapSeconds (same 15-min rule as categorization). Client
-- follow-ups inside a ticket are NOT new measurement points. FRT = seconds from
-- that opening client message to the next operator reply, capped at
-- :maxFrtSeconds.
--
-- Robust to ejabberd MAM double-storage: the two copies of each message are
-- deduplicated and the true author is recovered from `peer` (the recipient's
-- copy carries the sender's full jid with a /resource; the sender's copy is
-- bare). A message is an operator reply ('out') iff its author starts 'help'.
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
            business_seconds(created_at, next_out) AS frt_seconds
        FROM (
            SELECT
                created_at,
                direction,
                LAG(created_at) OVER w AS prev_created,
                MIN(CASE WHEN direction = 'out' THEN created_at END)
                    OVER (PARTITION BY client ORDER BY created_at
                          ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING) AS next_out
            FROM (
                SELECT DISTINCT
                    CASE WHEN username LIKE 'help%' THEN SUBSTRING_INDEX(bare_peer, '@', 1) ELSE username END AS client,
                    created_at,
                    txt,
                    CASE WHEN (CASE WHEN peer LIKE '%/%' THEN SUBSTRING_INDEX(peer, '@', 1) ELSE username END) LIKE 'help%'
                         THEN 'out' ELSE 'in' END AS direction
                FROM archive
                WHERE created_at >= :start
                  AND created_at < :endExclusive
                  AND TRIM(txt) <> ''
                  AND (username LIKE 'help%' OR peer LIKE 'help%')
                  ${groupFilter}
            ) AS dedup
            WINDOW w AS (PARTITION BY client ORDER BY created_at)
        ) AS marked
        WHERE direction = 'in'
          AND (prev_created IS NULL
               OR business_seconds(prev_created, created_at) > :sessionGapSeconds)
          AND next_out IS NOT NULL
    ) AS frt
    WHERE frt_seconds <= :maxFrtSeconds
) AS base
ORDER BY bucket
