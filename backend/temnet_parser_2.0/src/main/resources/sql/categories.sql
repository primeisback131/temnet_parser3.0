-- Tickets per problem category (classified once at ingest).
SELECT
    t.category AS category,
    COUNT(*)   AS requests
FROM ticket t
WHERE t.opened_at >= :start
  AND t.opened_at < :endExclusive
  ${groupFilter}
GROUP BY t.category
ORDER BY requests DESC
