-- Per-operator leaderboard: authored messages and distinct clients from the
-- message table; closed/rejected tickets by closing operator; average
-- first-response time over tickets this operator answered first.
SELECT
    stats.operator,
    stats.messages,
    COALESCE(closes.closed, 0)   AS closed,
    COALESCE(closes.rejected, 0) AS rejected,
    stats.clients,
    frt.avg_reply_seconds
FROM (
    SELECT m.author AS operator, COUNT(*) AS messages, COUNT(DISTINCT m.client) AS clients
    FROM message m
    WHERE m.direction = 'out'
      AND m.created_at >= :start AND m.created_at < :endExclusive
      ${groupFilterMessages}
    GROUP BY m.author
) AS stats
LEFT JOIN (
    SELECT t.closed_by AS operator, SUM(t.status = 'closed') AS closed, SUM(t.status = 'rejected') AS rejected
    FROM ticket t
    WHERE t.closed_at >= :start AND t.closed_at < :endExclusive
      ${groupFilterTickets}
    GROUP BY t.closed_by
) AS closes ON closes.operator = stats.operator
LEFT JOIN (
    SELECT t.first_responder AS operator, AVG(t.frt_seconds) AS avg_reply_seconds
    FROM ticket t
    WHERE t.opened_at >= :start AND t.opened_at < :endExclusive
      AND t.frt_seconds IS NOT NULL AND t.frt_seconds <= :maxReplySeconds
      ${groupFilterTickets}
    GROUP BY t.first_responder
) AS frt ON frt.operator = stats.operator
ORDER BY closed DESC, messages DESC
