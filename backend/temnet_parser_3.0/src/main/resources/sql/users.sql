-- Per-client stats within one group: ticket outcomes in the period, tickets
-- still open at its end, plus the number of messages in their support
-- conversation. Only clients with at least one message in the period.
SELECT
    cg.client                   AS user_name,
    COALESCE(tk.closed, 0)      AS closed_requests,
    COALESCE(tk.rejected, 0)    AS rejected_requests,
    COALESCE(tk.open_at_end, 0) AS open_requests,
    msg.total                   AS total_messages
FROM client_group cg
JOIN (
    SELECT client, COUNT(*) AS total
    FROM message
    WHERE created_at >= :start AND created_at < :endExclusive
    GROUP BY client
) AS msg ON msg.client = cg.client
LEFT JOIN (
    -- open_at_end: still open at the period boundary — opened before it and
    -- neither closed nor gone silent past the expiry threshold by then.
    SELECT client,
           SUM(status = 'closed' AND closed_at >= :start AND closed_at < :endExclusive)   AS closed,
           SUM(status = 'rejected' AND closed_at >= :start AND closed_at < :endExclusive) AS rejected,
           SUM(opened_at < :endExclusive
               AND COALESCE(closed_at, stale_at) >= :endExclusive)                        AS open_at_end
    FROM ticket
    GROUP BY client
) AS tk ON tk.client = cg.client
WHERE cg.grp = :groupName
ORDER BY user_name
