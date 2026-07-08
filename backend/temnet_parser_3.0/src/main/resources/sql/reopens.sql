-- Repeat requests per bucket. A reopen is a ticket opened shortly (within one
-- working day) after the same client's previous ticket was closed:
-- probable = any heuristic signal (marker words OR same category) or an LLM
-- verdict of "same"; confirmed = strong signal (marker words like "опять",
-- "не помогло") or the LLM verdict. `closed` closures in the same bucket give
-- the rate denominator.
SELECT
    bucket,
    SUM(closed)    AS closed,
    SUM(probable)  AS probable,
    SUM(confirmed) AS confirmed
FROM (
    SELECT ${bucketClosed} AS bucket, 1 AS closed, 0 AS probable, 0 AS confirmed
    FROM ticket t
    WHERE t.closed_at >= :start AND t.closed_at < :endExclusive
      AND t.status IN ('closed', 'rejected')
      ${groupFilter}
    UNION ALL
    SELECT ${bucketOpened}, 0, 1, IF(t.reopen_score >= 2 OR t.reopen_llm = 'same', 1, 0)
    FROM ticket t
    WHERE t.opened_at >= :start AND t.opened_at < :endExclusive
      AND (t.reopen_score > 0 OR t.reopen_llm = 'same')
      ${groupFilter}
) AS parts
GROUP BY bucket
ORDER BY bucket
