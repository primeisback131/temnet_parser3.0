SELECT
    WEEKDAY(m.created_at) AS weekday,
    HOUR(m.created_at)    AS hour,
    COUNT(*)              AS messages
FROM message m
WHERE m.created_at >= :start
  AND m.created_at < :endExclusive
  ${membership}
GROUP BY weekday, hour
