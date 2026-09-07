-- Tickets still open at the END of the period (the real backlog): opened
-- before the boundary and not yet resolved at it. A ticket stops being open
-- at COALESCE(closed_at, stale_at) — its closure, or, when it was never
-- closed, the moment its silence crossed the expiry threshold (expiry is
-- lazy, so abandoned tickets keep status 'open' and only stale_at marks
-- their real end).
--
-- The boundary is capped at the DATA HORIZON — the freshest ingested message.
-- Past it we simply know nothing: with no new messages every open ticket's
-- silence clock runs out within 20 working hours, so an uncapped count would
-- mechanically collapse to 0 and read as "no backlog" instead of "no data".
-- `as_of` is the moment the answer actually describes.
-- `boundary` is exclusive (like the midnight end of a normal period), so a
-- ticket closed by the very last message counts as resolved, not open.
-- `as_of` is the same moment for display: the last instant actually covered.
--
-- The age buckets say how long the open tickets have been waiting, in
-- CALENDAR days from opening to the boundary (working-day arithmetic is not
-- available in SQL; the labels say "days").
SELECT
    h.as_of                                                    AS as_of,
    COUNT(t.id)                                                AS open_tickets,
    COALESCE(SUM(DATEDIFF(h.boundary, t.opened_at) <= 1), 0)   AS age_day,
    COALESCE(SUM(DATEDIFF(h.boundary, t.opened_at) BETWEEN 2 AND 3), 0)  AS age_three_days,
    COALESCE(SUM(DATEDIFF(h.boundary, t.opened_at) BETWEEN 4 AND 7), 0)  AS age_week,
    COALESCE(SUM(DATEDIFF(h.boundary, t.opened_at) BETWEEN 8 AND 30), 0) AS age_month,
    COALESCE(SUM(DATEDIFF(h.boundary, t.opened_at) > 30), 0)   AS age_older,
    MIN(t.opened_at)                                           AS oldest_opened_at
FROM (
    SELECT
        COALESCE(LEAST(:endExclusive, (SELECT MAX(created_at) FROM message)), :endExclusive) AS as_of,
        COALESCE(LEAST(:endExclusive, (SELECT MAX(created_at) + INTERVAL 1 SECOND FROM message)),
                 :endExclusive) AS boundary
) AS h
LEFT JOIN ticket t
       ON t.opened_at < h.boundary
      AND COALESCE(t.closed_at, t.stale_at) >= h.boundary
      ${membership}
GROUP BY h.as_of
