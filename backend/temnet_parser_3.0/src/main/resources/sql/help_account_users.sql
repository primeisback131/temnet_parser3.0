-- Per-user stats across every organization (group) served by one help
-- account. A client belongs to the account if they exchanged messages with it
-- in the period; only those messages are counted, and only the tickets this
-- desk handled (ticket.account) — another desk's work with the same client
-- is not this desk's report.
SELECT
    cg.grp                   AS group_name,
    cg.client                AS user_name,
    COALESCE(tk.closed, 0)   AS closed_requests,
    COALESCE(tk.rejected, 0) AS rejected_requests,
    msg.total                AS total_messages
FROM client_group cg
JOIN (
    SELECT client, COUNT(*) AS total
    FROM message
    WHERE created_at >= :start AND created_at < :endExclusive
      AND ((direction = 'out' AND author = :account)
        OR (direction = 'in' AND recipient = :account))
    GROUP BY client
) AS msg ON msg.client = cg.client
LEFT JOIN (
    SELECT client,
           SUM(status = 'closed' AND closed_at >= :start AND closed_at < :endExclusive)   AS closed,
           SUM(status = 'rejected' AND closed_at >= :start AND closed_at < :endExclusive) AS rejected
    FROM ticket
    WHERE account = :account
    GROUP BY client
) AS tk ON tk.client = cg.client
WHERE cg.grp NOT LIKE 'help%'
  AND cg.grp != 'all'
ORDER BY group_name, user_name
