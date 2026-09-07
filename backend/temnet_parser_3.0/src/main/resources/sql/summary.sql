-- One-row quality summary of the tickets OPENED in the period, plus the
-- off-hours share of incoming messages. Everything not covered by the time
-- charts: how tickets ended, how many were never answered, how often the
-- reply came within a threshold, how heavy a ticket is, whether the client
-- said thanks. Percentages are left to the client; only counts travel.
--
-- A ticket that is still 'open' but whose silence crossed the expiry
-- threshold before the data horizon is abandoned - counted as expired, not
-- open (expiry is lazy, see backlog.sql). `unanswered` are ended tickets that
-- never got an operator message; tickets still open may yet be answered.
-- `handoffs` are tickets where more than one desk account wrote.
WITH base AS (
    SELECT
        t.client,
        t.status,
        t.frt_seconds,
        t.resolution_seconds,
        t.in_progress_at,
        t.pickup_seconds,
        t.thanked,
        t.replies,
        t.reply_seconds,
        t.messages_in + t.messages_out                                        AS msgs,
        t.status = 'open' AND t.stale_at >= ${effectiveEnd}                   AS still_open,
        t.first_response_at IS NULL                                           AS no_reply,
        NOT EXISTS (SELECT 1 FROM ticket p
                    WHERE p.client = t.client AND p.opened_at < :start)       AS new_client,
        (SELECT COUNT(DISTINCT m.author) FROM message m
         WHERE m.client = t.client AND m.direction = 'out'
           AND m.created_at >= t.opened_at
           AND m.created_at <= COALESCE(t.closed_at, t.last_activity)) > 1    AS handoff
    FROM ticket t
    WHERE t.opened_at >= :start AND t.opened_at < :endExclusive
      ${groupFilter}
)
SELECT s.*, msg.incoming, msg.off_hours
FROM (
    SELECT
    COUNT(*)                                                           AS opened,
    COALESCE(SUM(status = 'closed'), 0)                                AS closed,
    COALESCE(SUM(status = 'rejected'), 0)                              AS rejected,
    COALESCE(SUM(status IN ('expired', 'open') AND NOT still_open), 0) AS expired,
    COALESCE(SUM(still_open), 0)                                       AS still_open,
    COALESCE(SUM(no_reply AND NOT still_open), 0)                      AS unanswered,
    COALESCE(SUM(frt_seconds <= :maxFrtSeconds), 0)                    AS answered,
    COALESCE(SUM(frt_seconds <= :fastReplySeconds), 0)                 AS answered_fast,
    COALESCE(SUM(frt_seconds <= :hourReplySeconds), 0)                 AS answered_hour,
    COALESCE(SUM(status = 'closed'
                 AND resolution_seconds <= :maxResolutionSeconds), 0)  AS resolved,
    COALESCE(SUM(status = 'closed'
                 AND resolution_seconds <= :hourReplySeconds), 0)      AS resolved_hour,
    COALESCE(SUM(status = 'closed'
                 AND resolution_seconds <= :dayResolutionSeconds), 0)  AS resolved_day,
    COALESCE(SUM(in_progress_at IS NOT NULL), 0)                       AS in_progress,
    AVG(pickup_seconds)                                                AS avg_pickup_seconds,
    COALESCE(SUM(thanked), 0)                                          AS thanked,
    COALESCE(SUM(replies), 0)                                          AS replies,
    COALESCE(SUM(reply_seconds), 0)                                    AS reply_seconds,
    AVG(msgs)                                                          AS avg_messages,
    (SELECT DISTINCT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY msgs) OVER () FROM base) AS p50_messages,
    (SELECT DISTINCT PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY msgs) OVER () FROM base) AS p90_messages,
    COALESCE(SUM(handoff), 0)                                          AS handoffs,
    COUNT(DISTINCT client)                                             AS clients,
    COUNT(DISTINCT CASE WHEN new_client THEN client END)               AS new_clients
    FROM base
) AS s
CROSS JOIN (
    -- Incoming messages outside Mon-Fri 08:00-18:00 (BusinessTime's day).
    SELECT COUNT(*) AS incoming,
           COALESCE(SUM(WEEKDAY(m.created_at) >= 5
                        OR HOUR(m.created_at) < 8 OR HOUR(m.created_at) >= 18), 0) AS off_hours
    FROM message m
    WHERE m.direction = 'in'
      AND m.created_at >= :start AND m.created_at < :endExclusive
      ${membershipMessages}
) AS msg
