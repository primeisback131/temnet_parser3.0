-- First response time (FRT). Robust to ejabberd MAM double-storage: each
-- message is stored once per participant, so we first DEDUPLICATE the two
-- copies and recover the true author.
--
-- Author/direction rule: the recipient's copy stores `peer` as the sender's
-- FULL jid (with a /resource); the sender's copy stores a bare `peer`. So the
-- author is the peer's local part when `peer` has a resource, else `username`.
-- A message is an operator reply ('out') iff its author starts with 'help'.
--
-- For each inbound client burst-start, FRT = seconds to the next operator
-- reply in the same conversation, capped at :maxFrtSeconds. Per bucket we
-- report count, average, median (p50) and p90.
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
                  AND txt IS NOT NULL
                  AND txt != ' '
                  AND (username LIKE 'help%' OR peer LIKE 'help%')
                  ${groupFilter}
            ) AS dedup
            WINDOW w AS (PARTITION BY client ORDER BY created_at)
        ) AS bursts
        WHERE direction = 'in'
          AND (prev_direction IS NULL OR prev_direction = 'out')
          AND next_out IS NOT NULL
    ) AS frt
    WHERE frt_seconds <= :maxFrtSeconds
) AS base
ORDER BY bucket
