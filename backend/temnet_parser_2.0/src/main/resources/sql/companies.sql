SELECT
    sr_group.name                                                                                               AS group_name,
    COUNT(DISTINCT sr_user.jid)                                                                                 AS active_users,
    total_users.count                                                                                           AS total_users,
    SUM(IF(LOWER(archive.txt) LIKE '%закрыта заявка%' OR LOWER(archive.txt) LIKE '%заявка закрыта%', 1, 0))     AS closed_requests,
    SUM(IF(LOWER(archive.txt) LIKE '%отклонена заявка%' OR LOWER(archive.txt) LIKE '%заявка отклонена%', 1, 0)) AS rejected_requests,
    SUM(IF(LOWER(archive.txt) LIKE '%заявка в работе%' OR LOWER(archive.txt) LIKE '%в работе заявка%', 1, 0))   AS requests_in_progress,
    COUNT(*)                                                                                                    AS total_messages
FROM
    sr_group
        JOIN
    sr_user ON sr_group.name = sr_user.grp
        JOIN
    archive ON SUBSTRING_INDEX(sr_user.jid, '@', 1) = archive.username
        JOIN
    (SELECT sr_group.name, COUNT(DISTINCT sr_user.jid) AS count
     FROM sr_group
              LEFT JOIN sr_user ON sr_group.name = sr_user.grp
     GROUP BY sr_group.name) AS total_users ON total_users.name = sr_group.name
WHERE
    archive.created_at >= :start
  AND archive.created_at < :endExclusive
  AND TRIM(archive.txt) <> ''
  AND sr_group.name NOT LIKE 'help%'
  AND sr_group.name != 'all'
GROUP BY
    sr_group.name
