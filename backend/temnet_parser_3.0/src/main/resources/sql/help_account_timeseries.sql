-- Daily dynamics per group for one help account: messages exchanged with the
-- account, and closures of tickets of the clients it serves (closed/rejected
-- bucketed by closing date, like timeseries.sql).
SELECT
    group_name,
    bucket,
    SUM(messages) AS messages,
    SUM(closed)   AS closed,
    SUM(rejected) AS rejected
FROM (
    SELECT cg.grp AS group_name, DATE(m.created_at) AS bucket,
           COUNT(*) AS messages, 0 AS closed, 0 AS rejected
    FROM message m
    JOIN client_group cg
      ON cg.client = m.client AND cg.grp NOT LIKE 'help%' AND cg.grp != 'all'
    WHERE m.created_at >= :start AND m.created_at < :endExclusive
      AND ((m.direction = 'out' AND m.author = :account)
        OR (m.direction = 'in' AND m.recipient = :account))
    GROUP BY 1, 2
    UNION ALL
    SELECT cg.grp, DATE(t.closed_at), 0, SUM(t.status = 'closed'), SUM(t.status = 'rejected')
    FROM ticket t
    JOIN client_group cg
      ON cg.client = t.client AND cg.grp NOT LIKE 'help%' AND cg.grp != 'all'
    JOIN (
        SELECT DISTINCT client
        FROM message
        WHERE created_at >= :start AND created_at < :endExclusive
          AND ((direction = 'out' AND author = :account)
            OR (direction = 'in' AND recipient = :account))
    ) AS ac ON ac.client = t.client
    WHERE t.closed_at >= :start AND t.closed_at < :endExclusive
    GROUP BY 1, 2
) AS parts
GROUP BY group_name, bucket
ORDER BY group_name, bucket
