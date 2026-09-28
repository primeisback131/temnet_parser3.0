-- The incoming messages behind the "Вне рабочего времени" card, one row each,
-- for stepping through them in the chat. The same rows client_messages.sql
-- counts as off_hours_night + off_hours_weekend: outside BusinessTime's
-- Mon-Fri 08:00-18:00 day, in the period, within the caller's scope.
SELECT
    m.client                                                   AS client,
    (SELECT GROUP_CONCAT(DISTINCT cg.grp ORDER BY cg.grp SEPARATOR ', ')
     FROM client_group cg
     WHERE cg.client = m.client
       AND cg.grp NOT LIKE 'help%' AND cg.grp <> 'all')        AS group_names,
    m.created_at                                               AS at
FROM message m
WHERE m.direction = 'in'
  AND m.created_at >= :start AND m.created_at < ${effectiveEnd}
  AND (WEEKDAY(m.created_at) >= 5 OR HOUR(m.created_at) < 8 OR HOUR(m.created_at) >= 18)
  ${membership}
ORDER BY m.client, m.created_at
