-- The tickets behind the backlog count: still open at the END of the period,
-- with enough context to look each one up in the chat history. Same rule and
-- the same data-horizon cap as backlog.sql, so the row count here always
-- equals the number reported there.
--
-- final_status / closed_at describe what happened to the ticket AFTERWARDS
-- (it may well have been closed later) — handy when verifying by hand.
SELECT
    t.client                                                   AS client,
    (SELECT GROUP_CONCAT(DISTINCT cg.grp ORDER BY cg.grp SEPARATOR ', ')
     FROM client_group cg
     WHERE cg.client = t.client
       AND cg.grp NOT LIKE 'help%' AND cg.grp <> 'all')        AS group_names,
    t.opened_at                                                AS opened_at,
    t.last_activity                                            AS last_activity,
    t.category                                                 AS category,
    t.messages_in                                              AS messages_in,
    t.messages_out                                             AS messages_out,
    t.first_responder                                          AS first_responder,
    t.status                                                   AS final_status,
    t.closed_at                                                AS closed_at
FROM ticket t
WHERE t.opened_at < ${effectiveEnd}
  AND COALESCE(t.closed_at, t.stale_at) >= ${effectiveEnd}
  ${membership}
ORDER BY t.opened_at DESC
LIMIT 1000
