-- Per-group (company) stats: active/total members, ticket outcomes in the
-- period, tickets still open at its end and total conversation messages.
-- Groups without activity are hidden.
SELECT
    cg.grp                                                             AS group_name,
    COUNT(DISTINCT CASE WHEN msg.total IS NOT NULL THEN cg.client END) AS active_users,
    COUNT(DISTINCT cg.client)                                          AS total_users,
    COALESCE(SUM(tk.closed), 0)                                        AS closed_requests,
    COALESCE(SUM(tk.rejected), 0)                                      AS rejected_requests,
    COALESCE(SUM(tk.open_at_end), 0)                                   AS open_requests,
    COALESCE(SUM(msg.total), 0)                                        AS total_messages
FROM client_group cg
LEFT JOIN (
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
WHERE cg.grp NOT LIKE 'help%'
  AND cg.grp != 'all'
GROUP BY cg.grp
HAVING total_messages > 0
ORDER BY group_name
