-- Support chat history for one group's clients, already deduped and
-- author-attributed by the ingest.
SELECT
    m.author     AS sender,
    m.recipient  AS recipient,
    m.txt        AS message,
    m.created_at AS created_at
FROM message m
WHERE m.created_at >= :start
  AND m.created_at < :endExclusive
  AND EXISTS (SELECT 1 FROM client_group cg
              WHERE cg.client = m.client AND cg.grp = :groupName)
ORDER BY m.created_at
