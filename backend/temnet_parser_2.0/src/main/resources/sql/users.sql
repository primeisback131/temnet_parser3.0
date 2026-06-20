SELECT
    SUBSTRING_INDEX(sr_user.jid, '@', 1)                                                                        AS user_name,
    SUM(IF(LOWER(archive.txt) LIKE '%закрыта заявка%' OR LOWER(archive.txt) LIKE '%заявка закрыта%', 1, 0))     AS closed_requests,
    SUM(IF(LOWER(archive.txt) LIKE '%отклонена заявка%' OR LOWER(archive.txt) LIKE '%заявка отклонена%', 1, 0)) AS rejected_requests,
    SUM(IF(LOWER(archive.txt) LIKE '%заявка в работе%' OR LOWER(archive.txt) LIKE '%в работе заявка%', 1, 0))   AS requests_in_progress,
    COUNT(*)                                                                                                    AS total_messages
FROM
    sr_group
        LEFT JOIN
    sr_user ON sr_group.name = sr_user.grp
        LEFT JOIN
    archive ON SUBSTRING_INDEX(sr_user.jid, '@', 1) = archive.username
WHERE
    archive.created_at BETWEEN :start AND :end
  AND archive.txt IS NOT NULL
  AND sr_group.name = :groupName
GROUP BY
    sr_user.jid
