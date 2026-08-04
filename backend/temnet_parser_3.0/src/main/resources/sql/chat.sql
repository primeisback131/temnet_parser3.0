-- Support chat history for one group's clients, already deduped and
-- author-attributed by the ingest. ${scopeMessages} keeps a desk to its own
-- correspondence: two desks can serve the same client, and neither may read
-- the other's conversation with them.
SELECT
    m.author     AS sender,
    m.recipient  AS recipient,
    m.txt        AS message,
    m.created_at AS created_at
FROM message m
WHERE m.created_at >= :start
  AND m.created_at < :endExclusive
  ${scopeMessages}
ORDER BY m.created_at
