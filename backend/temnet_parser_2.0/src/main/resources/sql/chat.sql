SELECT username AS sender, peer AS recipient, txt AS message, created_at
FROM (
         SELECT
             username,
             SUBSTRING_INDEX(peer, '@', 1) AS peer,
             txt,
             created_at,
             ROW_NUMBER() OVER (
                 PARTITION BY
                     LEAST(username, SUBSTRING_INDEX(peer, '@', 1)),
                     GREATEST(username, SUBSTRING_INDEX(peer, '@', 1)),
                     txt
                 ORDER BY created_at
             ) AS rn
         FROM archive
         WHERE
             ((username LIKE CONCAT('%', :username, '%') AND peer LIKE '%help%')
                 OR (username LIKE '%help%' AND peer LIKE CONCAT('%', :username, '%')))
           AND created_at BETWEEN :start AND :end
           AND txt != ' '
     ) AS subquery
WHERE rn = 1
GROUP BY created_at
