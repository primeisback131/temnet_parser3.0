-- Repeat requests per group over the whole period, for the tickets one help
-- account handled. Same signals as reopens.sql: probable = any heuristic
-- signal or LLM "same"; confirmed = strong signal (marker words) or the LLM
-- verdict. `closed` closures give the rate denominator.
SELECT
    group_name,
    SUM(closed)    AS closed,
    SUM(probable)  AS probable,
    SUM(confirmed) AS confirmed
FROM (
    SELECT cg.grp AS group_name, 1 AS closed, 0 AS probable, 0 AS confirmed
    FROM ticket t
    JOIN client_group cg
      ON cg.client = t.client AND cg.grp NOT LIKE 'help%' AND cg.grp != 'all'
    WHERE t.account = :account
      AND t.closed_at >= :start AND t.closed_at < :endExclusive
      AND t.status IN ('closed', 'rejected')
    UNION ALL
    SELECT cg.grp, 0, 1, IF(t.reopen_score >= 2 OR t.reopen_llm = 'same', 1, 0)
    FROM ticket t
    JOIN client_group cg
      ON cg.client = t.client AND cg.grp NOT LIKE 'help%' AND cg.grp != 'all'
    WHERE t.account = :account
      AND t.opened_at >= :start AND t.opened_at < :endExclusive
      AND (t.reopen_score > 0 OR t.reopen_llm = 'same')
) AS parts
GROUP BY group_name
ORDER BY group_name
