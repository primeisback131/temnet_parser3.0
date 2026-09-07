-- Tickets per category per time bucket (by opening date), so a growing topic
-- shows as a trend instead of a single share for the period.
SELECT
    ${bucket}  AS bucket,
    t.category AS category,
    COUNT(*)   AS requests
FROM ticket t
WHERE t.opened_at >= :start
  AND t.opened_at < :endExclusive
  ${groupFilter}
GROUP BY 1, 2
ORDER BY 1, requests DESC
