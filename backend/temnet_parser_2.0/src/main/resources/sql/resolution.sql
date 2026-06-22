-- Ticket resolution time — from a ticket's opening client message to its
-- closure, in business hours, bucketed by closing date.
--
-- A ticket is delimited by CLOSURES, not by short pauses: a closure (operator
-- message "закрыта/отклонена заявка") ends a ticket, and the messages after it
-- belong to the next one. So `seg` = number of closures strictly before a row,
-- which is constant within a segment; each segment ends at exactly one closure.
-- The ticket's open = first client message in the segment; its close = that
-- closure. Robust to MAM double-storage (dedup + author by `peer`-resource).
-- Resolutions slower than :maxResolutionSeconds (5 working days) are dropped as
-- mis-pairings / stale closes.
SELECT DISTINCT
    bucket,
    COUNT(*)         OVER (PARTITION BY bucket) AS resolved,
    AVG(res_seconds) OVER (PARTITION BY bucket) AS avg_seconds,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY res_seconds) OVER (PARTITION BY bucket) AS p50_seconds,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY res_seconds) OVER (PARTITION BY bucket) AS p90_seconds
FROM (
    SELECT
        ${bucket}   AS bucket,
        res_seconds
    FROM (
        SELECT
            close_time,
            business_seconds(open_time, close_time) AS res_seconds
        FROM (
            SELECT
                client,
                seg,
                MIN(CASE WHEN direction = 'in' THEN created_at END) AS open_time,
                MAX(CASE WHEN is_close THEN created_at END)         AS close_time
            FROM (
                SELECT
                    client,
                    created_at,
                    direction,
                    is_close,
                    SUM(is_close) OVER (PARTITION BY client ORDER BY created_at
                                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS seg
                FROM (
                    SELECT
                        client,
                        created_at,
                        direction,
                        CASE WHEN direction = 'out' AND (
                                 LOWER(txt) LIKE '%закрыта заявка%' OR LOWER(txt) LIKE '%заявка закрыта%'
                              OR LOWER(txt) LIKE '%отклонена заявка%' OR LOWER(txt) LIKE '%заявка отклонена%'
                             ) THEN 1 ELSE 0 END AS is_close
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
                ) AS flagged
            ) AS seged
            GROUP BY client, seg
            HAVING close_time IS NOT NULL
               AND open_time IS NOT NULL
               AND open_time <= close_time
        ) AS tickets
        WHERE business_seconds(open_time, close_time) <= :maxResolutionSeconds
    ) AS capped
) AS base
ORDER BY bucket
