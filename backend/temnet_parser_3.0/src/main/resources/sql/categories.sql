-- Tickets per problem category (classified once at ingest), with what each
-- category costs: typical first response and resolution (medians, working
-- seconds, outliers capped like the SLA and resolution charts), messages per
-- ticket, and how many of its tickets were repeat requests or never answered.
SELECT DISTINCT
    category,
    COUNT(*)              OVER (PARTITION BY category) AS requests,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY frt)        OVER (PARTITION BY category) AS p50_frt_seconds,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY resolution) OVER (PARTITION BY category) AS p50_resolution_seconds,
    AVG(msgs)             OVER (PARTITION BY category) AS avg_messages,
    SUM(reopen)           OVER (PARTITION BY category) AS reopens,
    SUM(unanswered)       OVER (PARTITION BY category) AS unanswered
FROM (
    SELECT t.category,
           IF(t.frt_seconds <= :maxFrtSeconds, t.frt_seconds, NULL)                            AS frt,
           IF(t.status = 'closed' AND t.resolution_seconds <= :maxResolutionSeconds,
              t.resolution_seconds, NULL)                                                        AS resolution,
           t.messages_in + t.messages_out                                                        AS msgs,
           t.reopen_score > 0 OR t.reopen_llm = 'same'                                           AS reopen,
           t.first_response_at IS NULL AND NOT (t.status = 'open' AND t.stale_at >= ${effectiveEnd}) AS unanswered
    FROM ticket t
    WHERE t.opened_at >= :start
      AND t.opened_at < :endExclusive
      ${groupFilter}
) AS base
ORDER BY requests DESC
