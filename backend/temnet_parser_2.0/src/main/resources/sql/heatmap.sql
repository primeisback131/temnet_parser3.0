SELECT
    WEEKDAY(archive.created_at) AS weekday,
    HOUR(archive.created_at)    AS hour,
    COUNT(*)                    AS messages
FROM
    sr_group
        LEFT JOIN
    sr_user ON sr_group.name = sr_user.grp
        LEFT JOIN
    archive ON SUBSTRING_INDEX(sr_user.jid, '@', 1) = archive.username
WHERE
    archive.created_at >= :start
  AND archive.created_at < :endExclusive
  AND TRIM(archive.txt) <> ''
  AND sr_group.name NOT LIKE 'help%'
  AND sr_group.name != 'all'
  ${groupFilter}
GROUP BY weekday, hour
