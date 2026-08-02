-- Support (help*) accounts seen in the ingested conversations: the operator
-- side of a message is the author of an 'out' row or the recipient of an
-- 'in' row. UNION deduplicates the two sides.
SELECT author AS account
FROM message
WHERE direction = 'out'
UNION
SELECT recipient
FROM message
WHERE direction = 'in'
ORDER BY account
