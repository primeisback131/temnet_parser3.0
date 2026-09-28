-- The tickets behind the ticket cards of the metrics screen, one row each,
-- with the flags the cards count. Two cohorts share the query (${period}):
--   opened - tickets OPENED in the period, the population of summary.sql.
--            Each flag is the per-row form of its SUM there, so a card and
--            its drill-down cannot disagree (MetricsDrillDownTest holds this);
--   closed - tickets CLOSED or REJECTED in the period, the "Закрыто" and
--            "Отклонено" cards, which timeseries.sql counts by closing date.
--
-- `status` is the effective one: a ticket still 'open' whose silence crossed
-- the expiry threshold before the data horizon is abandoned and reads
-- 'expired' (expiry is lazy, see backlog.sql). `reopened` - a later ticket
-- of the client was a probable repeat of this one (same rule as reopens.sql);
-- the repeat must be in the caller's scope too (${reopenScope}): a desk sees
-- whether the client came back to it, not to another desk.
SELECT
    b.client                                                   AS client,
    (SELECT GROUP_CONCAT(DISTINCT cg.grp ORDER BY cg.grp SEPARATOR ', ')
     FROM client_group cg
     WHERE cg.client = b.client
       AND cg.grp NOT LIKE 'help%' AND cg.grp <> 'all')        AS group_names,
    b.opened_at                                                AS opened_at,
    b.last_activity                                            AS last_activity,
    b.closed_at                                                AS closed_at,
    CASE WHEN b.still_open THEN 'open'
         WHEN b.status IN ('expired', 'open') THEN 'expired'
         ELSE b.status END                                     AS status,
    b.category                                                 AS category,
    b.messages_in                                              AS messages_in,
    b.messages_out                                             AS messages_out,
    b.first_responder                                          AS first_responder,
    b.frt_seconds                                              AS frt_seconds,
    b.closed_by                                                AS closed_by,
    b.resolution_seconds                                       AS resolution_seconds,
    b.first_response_at IS NULL                                AS no_reply,
    b.awaiting_since IS NOT NULL                               AS awaiting,
    b.thanked AND b.status = 'closed'                          AS thanked,
    EXISTS (SELECT 1 FROM ticket r
            WHERE r.reopened_from = b.id
              AND (r.reopen_score > 0 OR r.reopen_llm = 'same')
              ${reopenScope})                                  AS reopened,
    COALESCE(b.frt_seconds <= :maxFrtSeconds, 0)               AS answered,
    COALESCE(b.frt_seconds <= :fastReplySeconds, 0)            AS answered_fast,
    COALESCE(b.frt_seconds <= :hourReplySeconds, 0)            AS answered_hour,
    COALESCE(b.status = 'closed'
             AND b.resolution_seconds <= :maxResolutionSeconds, 0) AS resolved,
    COALESCE(b.status = 'closed'
             AND b.resolution_seconds <= :hourReplySeconds, 0)     AS resolved_hour,
    COALESCE(b.status = 'closed'
             AND b.resolution_seconds <= :dayResolutionSeconds, 0) AS resolved_day
FROM (
    SELECT t.*,
           t.status = 'open' AND t.stale_at >= ${effectiveEnd} AS still_open
    FROM ticket t
    WHERE ${period}
      ${groupFilter}
) AS b
ORDER BY b.opened_at DESC
LIMIT :limit
