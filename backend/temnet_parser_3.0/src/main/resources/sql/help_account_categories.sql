-- Tickets per problem category per group, for tickets of the clients served
-- by one help account (categories are classified once at ingest).
SELECT
    cg.grp     AS group_name,
    t.category AS category,
    COUNT(*)   AS requests
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
WHERE t.opened_at >= :start AND t.opened_at < :endExclusive
GROUP BY cg.grp, t.category
ORDER BY group_name, requests DESC
