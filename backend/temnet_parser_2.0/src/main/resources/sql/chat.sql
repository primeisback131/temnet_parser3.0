-- Support chat history for one group's clients (client <-> help conversations).
--
-- Robust to ejabberd MAM double-storage: each message is stored twice (the
-- sender's copy and the recipient's copy). The true author is recovered from
-- `peer` — the recipient's copy carries the sender's full jid with a
-- /resource, the sender's copy is bare — after which the two copies become
-- identical rows and collapse via DISTINCT. Repeated identical texts at
-- different times are preserved (created_at is part of the distinct key).
SELECT sender, recipient, message, created_at
FROM (
    SELECT DISTINCT
        CASE WHEN peer LIKE '%/%' THEN SUBSTRING_INDEX(peer, '@', 1) ELSE username END AS sender,
        CASE WHEN peer LIKE '%/%' THEN username ELSE SUBSTRING_INDEX(peer, '@', 1) END AS recipient,
        txt AS message,
        created_at,
        CASE WHEN username LIKE 'help%' THEN SUBSTRING_INDEX(bare_peer, '@', 1) ELSE username END AS client
    FROM archive
    WHERE created_at >= :start
      AND created_at < :endExclusive
      AND TRIM(txt) <> ''
      AND (username LIKE 'help%' OR peer LIKE 'help%')
) AS dedup
WHERE EXISTS (SELECT 1 FROM sr_user su
              WHERE SUBSTRING_INDEX(su.jid, '@', 1) = client
                AND su.grp = :groupName)
ORDER BY created_at
