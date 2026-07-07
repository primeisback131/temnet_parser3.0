-- Currently open tickets (the live backlog as of the latest ingested data).
SELECT
    t.client,
    (SELECT GROUP_CONCAT(DISTINCT cg.grp ORDER BY cg.grp SEPARATOR ', ')
     FROM client_group cg
     WHERE cg.client = t.client AND cg.grp NOT LIKE 'help%' AND cg.grp <> 'all') AS groups,
    t.category,
    t.opened_at,
    t.last_activity,
    t.first_response_at,
    t.messages_in,
    t.messages_out
FROM ticket t
WHERE t.status = 'open'
  ${groupFilter}
ORDER BY t.opened_at
