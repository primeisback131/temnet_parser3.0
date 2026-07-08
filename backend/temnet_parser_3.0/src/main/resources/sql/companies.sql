-- Per-group (company) stats: active/total members, ticket outcomes in the
-- period and total conversation messages. Groups without activity are hidden.
SELECT
    cg.grp                                                             AS group_name,
    COUNT(DISTINCT CASE WHEN msg.total IS NOT NULL THEN cg.client END) AS active_users,
    COUNT(DISTINCT cg.client)                                          AS total_users,
    COALESCE(SUM(tk.closed), 0)                                        AS closed_requests,
    COALESCE(SUM(tk.rejected), 0)                                      AS rejected_requests,
    COALESCE(SUM(tk.in_progress), 0)                                   AS requests_in_progress,
    COALESCE(SUM(msg.total), 0)                                        AS total_messages
FROM client_group cg
LEFT JOIN (
    SELECT client, COUNT(*) AS total
    FROM message
    WHERE created_at >= :start AND created_at < :endExclusive
    GROUP BY client
) AS msg ON msg.client = cg.client
LEFT JOIN (
    SELECT client,
           SUM(status = 'closed' AND closed_at >= :start AND closed_at < :endExclusive)   AS closed,
           SUM(status = 'rejected' AND closed_at >= :start AND closed_at < :endExclusive) AS rejected,
           SUM(in_progress_at >= :start AND in_progress_at < :endExclusive)               AS in_progress
    FROM ticket
    GROUP BY client
) AS tk ON tk.client = cg.client
WHERE cg.grp NOT LIKE 'help%'
  AND cg.grp != 'all'
GROUP BY cg.grp
HAVING total_messages > 0
ORDER BY group_name
