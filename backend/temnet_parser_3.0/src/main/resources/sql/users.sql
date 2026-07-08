-- Per-client stats within one group: ticket outcomes in the period plus the
-- number of messages in their support conversation. Only clients with at
-- least one message in the period are listed.
SELECT
    cg.client                   AS user_name,
    COALESCE(tk.closed, 0)      AS closed_requests,
    COALESCE(tk.rejected, 0)    AS rejected_requests,
    COALESCE(tk.in_progress, 0) AS requests_in_progress,
    msg.total                   AS total_messages
FROM client_group cg
JOIN (
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
WHERE cg.grp = :groupName
ORDER BY user_name
