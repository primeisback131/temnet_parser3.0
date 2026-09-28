-- Messages of the period per client, behind the "Сообщений" and "Вне
-- рабочего времени" cards: the same rows timeseries.sql and summary.sql
-- count, so the per-client figures add up to the cards. Off-hours incoming
-- is split into weekday nights and weekends (BusinessTime's Mon-Fri
-- 08:00-18:00 day); together they are summary.sql's off_hours.
SELECT
    m.client                                                   AS client,
    (SELECT GROUP_CONCAT(DISTINCT cg.grp ORDER BY cg.grp SEPARATOR ', ')
     FROM client_group cg
     WHERE cg.client = m.client
       AND cg.grp NOT LIKE 'help%' AND cg.grp <> 'all')        AS group_names,
    SUM(m.direction = 'in')                                    AS messages_in,
    SUM(m.direction = 'out')                                   AS messages_out,
    SUM(m.direction = 'in' AND WEEKDAY(m.created_at) < 5
        AND (HOUR(m.created_at) < 8 OR HOUR(m.created_at) >= 18)) AS off_hours_night,
    SUM(m.direction = 'in' AND WEEKDAY(m.created_at) >= 5)     AS off_hours_weekend
FROM message m
WHERE m.created_at >= :start AND m.created_at < ${effectiveEnd}
  ${membership}
GROUP BY m.client
ORDER BY COUNT(*) DESC
