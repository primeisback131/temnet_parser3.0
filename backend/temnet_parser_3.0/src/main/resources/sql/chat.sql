-- Support chat history for one group's clients, already deduped and
-- author-attributed by the ingest. ${scopeMessages} keeps a desk to its own
-- correspondence: two desks can serve the same client, and neither may read
-- the other's conversation with them. ${clientFilter} narrows the history to
-- one client's conversation — the screen shows one at a time and must not
-- pull a whole group's year of text to do it.
SELECT
    m.client     AS client,
    m.author     AS sender,
    m.recipient  AS recipient,
    m.direction  AS direction,
    m.txt        AS message,
    m.created_at AS created_at
FROM message m
WHERE m.created_at >= :start
  AND m.created_at < :endExclusive
  ${clientFilter}
  ${scopeMessages}
ORDER BY m.created_at
