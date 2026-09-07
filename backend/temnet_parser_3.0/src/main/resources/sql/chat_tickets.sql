-- The tickets behind one client's conversation, for the markers the chat
-- screen draws between messages: every ticket that overlaps the period
-- (opened before its end and still alive - closed or last active - after its
-- start). `reopen` is the same "probable repeat" rule the reopens metric uses.
SELECT
    t.opened_at                                          AS opened_at,
    t.in_progress_at                                     AS in_progress_at,
    t.closed_at                                          AS closed_at,
    t.last_activity                                      AS last_activity,
    t.status                                             AS status,
    t.category                                           AS category,
    t.frt_seconds                                        AS frt_seconds,
    t.resolution_seconds                                 AS resolution_seconds,
    t.closed_by                                          AS closed_by,
    (t.reopen_score > 0 OR t.reopen_llm = 'same')        AS reopen,
    t.thanked                                            AS thanked
FROM ticket t
WHERE t.client = :client
  AND t.opened_at < :endExclusive
  AND COALESCE(t.closed_at, t.last_activity) >= :start
  ${scopeTickets}
ORDER BY t.opened_at
