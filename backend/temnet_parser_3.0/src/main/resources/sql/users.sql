-- Per-client stats within one group: ticket outcomes in the period, tickets
-- still open at its end, plus the number of messages in their support
-- conversation. A client is listed when anything of theirs falls into the
-- period — a message, a closure, or a ticket still open at its end — which
-- is exactly what the company table sums over, so these rows add up to it.
SELECT
    cg.client                   AS user_name,
    COALESCE(tk.closed, 0)      AS closed_requests,
    COALESCE(tk.rejected, 0)    AS rejected_requests,
    COALESCE(tk.open_at_end, 0) AS open_requests,
    COALESCE(msg.total, 0)      AS total_messages
FROM client_group cg
LEFT JOIN (
    SELECT m.client AS client, COUNT(*) AS total
    FROM message m
    WHERE m.created_at >= :start AND m.created_at < :endExclusive
      ${scopeMessages}
    GROUP BY m.client
) AS msg ON msg.client = cg.client
LEFT JOIN (
    -- open_at_end: still open at the period boundary — opened before it and
    -- neither closed nor gone silent past the expiry threshold by then.
    -- The boundary is ${backlogBoundary}: the period end capped at the data
    -- horizon, exactly as /metrics/backlog does it. Without the cap a period
    -- reaching past the data reports 0 (everything has gone stale) while the
    -- metrics tile shows the real number.
    SELECT t.client AS client,
           SUM(t.status = 'closed' AND t.closed_at >= :start AND t.closed_at < :endExclusive)   AS closed,
           SUM(t.status = 'rejected' AND t.closed_at >= :start AND t.closed_at < :endExclusive) AS rejected,
           SUM(t.opened_at < ${backlogBoundary}
               AND COALESCE(t.closed_at, t.stale_at) >= ${backlogBoundary})                     AS open_at_end
    FROM ticket t
    WHERE 1 = 1 ${scopeTickets}
    GROUP BY t.client
) AS tk ON tk.client = cg.client
WHERE cg.grp = :groupName
  AND (msg.total > 0 OR tk.closed > 0 OR tk.rejected > 0 OR tk.open_at_end > 0)
ORDER BY user_name
