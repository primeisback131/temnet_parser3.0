-- Clients of the scope who exchanged messages with support in the period:
-- the conversation list of the chat screen. Resolved for the CHATS grant,
-- unlike /users (a METRICS report), so a desk granted chats but not metrics
-- still gets its list.
SELECT DISTINCT m.client AS client
FROM message m
WHERE m.created_at >= :start
  AND m.created_at < :endExclusive
  ${scopeMessages}
ORDER BY client
