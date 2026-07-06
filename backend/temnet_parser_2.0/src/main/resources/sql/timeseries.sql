-- Message/request counts per time bucket. Group membership is checked with
-- EXISTS (not a join) so a user belonging to several groups does not get his
-- messages counted once per group.
SELECT
    ${bucket}                                                                                                   AS bucket,
    COUNT(*)                                                                                                    AS messages,
    SUM(IF(LOWER(archive.txt) LIKE '%закрыта заявка%' OR LOWER(archive.txt) LIKE '%заявка закрыта%', 1, 0))     AS closed,
    SUM(IF(LOWER(archive.txt) LIKE '%отклонена заявка%' OR LOWER(archive.txt) LIKE '%заявка отклонена%', 1, 0)) AS rejected,
    SUM(IF(LOWER(archive.txt) LIKE '%заявка в работе%' OR LOWER(archive.txt) LIKE '%в работе заявка%', 1, 0))   AS in_progress
FROM archive
WHERE
    archive.created_at >= :start
  AND archive.created_at < :endExclusive
  AND TRIM(archive.txt) <> ''
  AND EXISTS (SELECT 1 FROM sr_user su
              WHERE SUBSTRING_INDEX(su.jid, '@', 1) = archive.username
                AND su.grp NOT LIKE 'help%'
                AND su.grp != 'all'
                ${groupFilter})
GROUP BY bucket
ORDER BY bucket
