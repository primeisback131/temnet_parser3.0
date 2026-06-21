-- Per-operator leaderboard. An operator is a support account whose username
-- starts with "help" (help, helpm, help-praveks, ...). For each operator over
-- the period: message volume, closed/rejected requests, distinct clients
-- served, and average reply latency (seconds from the preceding client message
-- to the operator's reply, capped to drop overnight gaps).
SELECT
    operator,
    COUNT(*)               AS messages,
    SUM(is_closed)         AS closed,
    SUM(is_rejected)       AS rejected,
    COUNT(DISTINCT client) AS clients,
    AVG(reply_gap)         AS avg_reply_seconds
FROM (
    SELECT
        operator,
        client,
        is_closed,
        is_rejected,
        CASE WHEN prev_dir = 'in' AND gap_seconds <= :maxReplySeconds THEN gap_seconds END AS reply_gap
    FROM (
        SELECT
            username                      AS operator,
            SUBSTRING_INDEX(peer, '@', 1) AS client,
            direction,
            CASE WHEN LOWER(txt) LIKE '%закрыта заявка%' OR LOWER(txt) LIKE '%заявка закрыта%' THEN 1 ELSE 0 END     AS is_closed,
            CASE WHEN LOWER(txt) LIKE '%отклонена заявка%' OR LOWER(txt) LIKE '%заявка отклонена%' THEN 1 ELSE 0 END AS is_rejected,
            LAG(direction) OVER w  AS prev_dir,
            TIMESTAMPDIFF(SECOND, LAG(created_at) OVER w, created_at) AS gap_seconds
        FROM (
            SELECT
                created_at, username, peer, txt,
                CASE WHEN username LIKE 'help%' THEN 'out' ELSE 'in' END AS direction,
                CASE WHEN username LIKE 'help%' THEN SUBSTRING_INDEX(peer, '@', 1) ELSE username END AS conv_user
            FROM archive
            WHERE created_at >= :start
              AND created_at < :endExclusive
              AND txt IS NOT NULL
              AND txt != ' '
              AND (username LIKE 'help%' OR peer LIKE 'help%')
        ) AS classified
        WINDOW w AS (PARTITION BY conv_user ORDER BY created_at)
    ) AS lagged
    WHERE direction = 'out'
      ${groupFilter}
) AS ops
GROUP BY operator
ORDER BY closed DESC, messages DESC
