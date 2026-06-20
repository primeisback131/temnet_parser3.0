SELECT
    ${bucket}                                                                                                   AS bucket,
    COUNT(*)                                                                                                    AS messages,
    SUM(IF(LOWER(archive.txt) LIKE '%закрыта заявка%' OR LOWER(archive.txt) LIKE '%заявка закрыта%', 1, 0))     AS closed,
    SUM(IF(LOWER(archive.txt) LIKE '%отклонена заявка%' OR LOWER(archive.txt) LIKE '%заявка отклонена%', 1, 0)) AS rejected,
    SUM(IF(LOWER(archive.txt) LIKE '%заявка в работе%' OR LOWER(archive.txt) LIKE '%в работе заявка%', 1, 0))   AS in_progress
FROM
    sr_group
        LEFT JOIN
    sr_user ON sr_group.name = sr_user.grp
        LEFT JOIN
    archive ON SUBSTRING_INDEX(sr_user.jid, '@', 1) = archive.username
WHERE
    archive.created_at >= :start
  AND archive.created_at < :endExclusive
  AND archive.txt IS NOT NULL
  AND sr_group.name NOT LIKE 'help%'
  AND sr_group.name != 'all'
  ${groupFilter}
GROUP BY bucket
ORDER BY bucket
