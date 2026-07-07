-- Per-bucket message volume and ticket outcomes, from the analytics DB.
-- Messages are bucketed by when they were sent; closed/rejected by the
-- ticket's closing date; "in progress" by when the status was announced.
SELECT
    bucket,
    SUM(messages)    AS messages,
    SUM(closed)      AS closed,
    SUM(rejected)    AS rejected,
    SUM(in_progress) AS in_progress
FROM (
    SELECT ${bucketMessages} AS bucket, COUNT(*) AS messages, 0 AS closed, 0 AS rejected, 0 AS in_progress
    FROM message m
    WHERE m.created_at >= :start AND m.created_at < :endExclusive
      ${membershipMessages}
    GROUP BY 1
    UNION ALL
    SELECT ${bucketClosed}, 0, SUM(t.status = 'closed'), SUM(t.status = 'rejected'), 0
    FROM ticket t
    WHERE t.closed_at >= :start AND t.closed_at < :endExclusive
      ${membershipTickets}
    GROUP BY 1
    UNION ALL
    SELECT ${bucketInProgress}, 0, 0, 0, COUNT(*)
    FROM ticket t
    WHERE t.in_progress_at >= :start AND t.in_progress_at < :endExclusive
      ${membershipTickets}
    GROUP BY 1
) AS parts
GROUP BY bucket
ORDER BY bucket
