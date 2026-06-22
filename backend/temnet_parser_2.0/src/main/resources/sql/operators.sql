-- Per-operator leaderboard. Robust to ejabberd MAM double-storage: messages
-- are deduplicated and the true author is recovered (operator iff the author's
-- jid starts with 'help'; the author is the peer's local part when `peer`
-- carries a /resource — the recipient's copy — else `username`).
--
-- For each operator over the period: count of authored messages, closed and
-- rejected requests they issued, distinct clients served, and average reply
-- latency (seconds from the preceding client message to the operator's reply,
-- capped to drop overnight gaps).
SELECT
    operator,
    COUNT(*)               AS messages,
    SUM(is_closed)         AS closed,
    SUM(is_rejected)       AS rejected,
    COUNT(DISTINCT client) AS clients,
    AVG(reply_gap)         AS avg_reply_seconds
FROM (
    SELECT
        author AS operator,
        client,
        is_closed,
        is_rejected,
        CASE WHEN prev_is_op = 0 AND gap_seconds <= :maxReplySeconds THEN gap_seconds END AS reply_gap
    FROM (
        SELECT
            author,
            client,
            is_op,
            is_closed,
            is_rejected,
            LAG(is_op) OVER w AS prev_is_op,
            business_seconds(LAG(created_at) OVER w, created_at) AS gap_seconds
        FROM (
            SELECT
                created_at,
                client,
                author,
                CASE WHEN author LIKE 'help%' THEN 1 ELSE 0 END AS is_op,
                IF(author LIKE 'help%' AND (LOWER(txt) LIKE '%закрыта заявка%' OR LOWER(txt) LIKE '%заявка закрыта%'), 1, 0)     AS is_closed,
                IF(author LIKE 'help%' AND (LOWER(txt) LIKE '%отклонена заявка%' OR LOWER(txt) LIKE '%заявка отклонена%'), 1, 0) AS is_rejected
            FROM (
                SELECT DISTINCT
                    created_at,
                    txt,
                    CASE WHEN username LIKE 'help%' THEN SUBSTRING_INDEX(bare_peer, '@', 1) ELSE username END AS client,
                    CASE WHEN peer LIKE '%/%' THEN SUBSTRING_INDEX(peer, '@', 1) ELSE username END AS author
                FROM archive
                WHERE created_at >= :start
                  AND created_at < :endExclusive
                  AND TRIM(txt) <> ''
                  AND (username LIKE 'help%' OR peer LIKE 'help%')
                  ${groupFilter}
            ) AS dedup
        ) AS classified
        WINDOW w AS (PARTITION BY client ORDER BY created_at)
    ) AS lagged
    WHERE is_op = 1
) AS ops
GROUP BY operator
ORDER BY closed DESC, messages DESC
