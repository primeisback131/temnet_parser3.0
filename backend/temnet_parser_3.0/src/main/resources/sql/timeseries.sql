-- Per-bucket message volume, ticket outcomes and the open backlog.
-- Messages are bucketed by when they were sent; closed/rejected by the
-- ticket's closing date.
--
-- `backlog` is how many tickets were STILL OPEN at the END of each bucket:
-- the count open at the period start plus the running balance of tickets
-- opened minus tickets resolved. A ticket stops being open at
-- COALESCE(closed_at, stale_at) — its closure, or, when it was never closed,
-- the moment its silence crossed the expiry threshold. stale_at is required
-- because expiry is lazy: the engine only marks a ticket 'expired' when the
-- client writes again, so abandoned tickets keep status 'open' forever.
--
-- The period end is capped at the DATA HORIZON (the freshest ingested
-- message). Without the cap, expiries keep arriving for two working days
-- after the last message and draw a phantom tail where the backlog slides to
-- zero — an artefact of the data ending, not of anything that happened.
SELECT
    bucket,
    SUM(messages) AS messages,
    SUM(closed)   AS closed,
    SUM(rejected) AS rejected,
    (SELECT COUNT(*)
     FROM ticket t
     WHERE t.opened_at < :start
       AND COALESCE(t.closed_at, t.stale_at) >= :start
       ${membershipBaseline})
        + SUM(SUM(opened) - SUM(resolved)) OVER (ORDER BY bucket) AS backlog
FROM (
    SELECT ${bucketMessages} AS bucket, COUNT(*) AS messages, 0 AS closed, 0 AS rejected,
           0 AS opened, 0 AS resolved
    FROM message m
    WHERE m.created_at >= :start AND m.created_at < ${effectiveEnd}
      ${membershipMessages}
    GROUP BY 1
    UNION ALL
    SELECT ${bucketClosed}, 0, SUM(t.status = 'closed'), SUM(t.status = 'rejected'), 0, 0
    FROM ticket t
    WHERE t.closed_at >= :start AND t.closed_at < ${effectiveEnd}
      ${membershipTickets}
    GROUP BY 1
    UNION ALL
    SELECT ${bucketOpened}, 0, 0, 0, COUNT(*), 0
    FROM ticket t
    WHERE t.opened_at >= :start AND t.opened_at < ${effectiveEnd}
      ${membershipTickets}
    GROUP BY 1
    UNION ALL
    SELECT ${bucketResolved}, 0, 0, 0, 0, COUNT(*)
    FROM ticket t
    WHERE COALESCE(t.closed_at, t.stale_at) >= :start
      AND COALESCE(t.closed_at, t.stale_at) < ${effectiveEnd}
      ${membershipTickets}
    GROUP BY 1
) AS parts
GROUP BY bucket
ORDER BY bucket
