-- Clients with the most tickets opened in the period ("frequent flyers"),
-- with what those tickets cost in messages and whether the client is new -
-- no ticket of theirs before the period start.
SELECT
    t.client                                                   AS client,
    (SELECT GROUP_CONCAT(DISTINCT cg.grp ORDER BY cg.grp SEPARATOR ', ')
     FROM client_group cg
     WHERE cg.client = t.client
       AND cg.grp NOT LIKE 'help%' AND cg.grp <> 'all')        AS group_names,
    COUNT(*)                                                   AS tickets,
    SUM(t.messages_in + t.messages_out)                        AS messages,
    SUM(t.reopen_score > 0 OR t.reopen_llm = 'same')           AS reopens,
    NOT EXISTS (SELECT 1 FROM ticket p
                WHERE p.client = t.client AND p.opened_at < :start) AS new_client
FROM ticket t
WHERE t.opened_at >= :start AND t.opened_at < :endExclusive
  ${groupFilter}
GROUP BY t.client
ORDER BY tickets DESC, messages DESC
LIMIT :limit
