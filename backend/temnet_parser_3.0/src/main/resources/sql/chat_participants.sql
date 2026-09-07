-- Conversation list of the chat screen: every client of the scope who
-- exchanged messages with support in the period, freshest first, with the
-- period's message count and the last message as a preview. Resolved for the
-- CHATS grant, unlike /users (a METRICS report), so a desk granted chats but
-- not metrics still gets its list.
SELECT client, last_at, messages, last_text, last_direction
FROM (
    SELECT m.client                                                       AS client,
           m.created_at                                                   AS last_at,
           COUNT(*) OVER (PARTITION BY m.client)                          AS messages,
           LEFT(m.txt, 140)                                               AS last_text,
           m.direction                                                    AS last_direction,
           ROW_NUMBER() OVER (PARTITION BY m.client ORDER BY m.created_at DESC, m.id DESC) AS rn
    FROM message m
    WHERE m.created_at >= :start
      AND m.created_at < :endExclusive
      ${scopeMessages}
) AS ranked
WHERE rn = 1
ORDER BY last_at DESC
