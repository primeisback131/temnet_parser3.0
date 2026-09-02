-- Tickets per problem category per group, for the tickets one help account
-- handled (categories are classified once at ingest).
SELECT
    cg.grp     AS group_name,
    t.category AS category,
    COUNT(*)   AS requests
FROM ticket t
JOIN client_group cg
  ON cg.client = t.client AND cg.grp NOT LIKE 'help%' AND cg.grp != 'all'
WHERE t.account = :account
  AND t.opened_at >= :start AND t.opened_at < :endExclusive
GROUP BY cg.grp, t.category
ORDER BY group_name, requests DESC
