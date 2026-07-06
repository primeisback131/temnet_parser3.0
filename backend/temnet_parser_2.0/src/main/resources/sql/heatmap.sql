-- Message counts by weekday/hour. Group membership is checked with EXISTS
-- (not a join) so a user belonging to several groups does not get his
-- messages counted once per group.
SELECT
    WEEKDAY(archive.created_at) AS weekday,
    HOUR(archive.created_at)    AS hour,
    COUNT(*)                    AS messages
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
GROUP BY weekday, hour
