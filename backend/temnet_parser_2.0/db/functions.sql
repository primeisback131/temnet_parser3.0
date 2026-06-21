-- Working-time helper used by the time-based metrics (SLA, operator latency,
-- ticket/session boundaries). Counts only business seconds between two
-- timestamps: Monday–Friday, 08:00–18:00 (10h/day). Nights (18:00–08:00) and
-- weekends are excluded, because operators do not work then and that idle time
-- must not inflate response times.
--
-- Load once into the database:  mariadb -uroot -p ejabberd < functions.sql
--
-- Business hours are hardcoded below (WORK_START=08:00, WORK_END=18:00). The
-- reference date '2000-01-03' is a Monday; the function assumes its arguments
-- are on/after it (true for all real data).

DROP FUNCTION IF EXISTS business_seconds;

DELIMITER $$

CREATE FUNCTION business_seconds(a DATETIME, b DATETIME)
RETURNS BIGINT
DETERMINISTIC
BEGIN
    DECLARE work_start INT DEFAULT 28800;  -- 08:00 in seconds
    DECLARE work_end   INT DEFAULT 64800;  -- 18:00 in seconds
    DECLARE day_len    INT DEFAULT 36000;  -- 10h working day
    DECLARE ba BIGINT;
    DECLARE bb BIGINT;

    IF a IS NULL OR b IS NULL OR b <= a THEN
        RETURN 0;
    END IF;

    -- Business seconds from the reference Monday to `a`.
    SET ba =
        (DATEDIFF(DATE(a), '2000-01-03') DIV 7) * 5 * day_len
        + LEAST(DATEDIFF(DATE(a), '2000-01-03') MOD 7, 5) * day_len
        + CASE WHEN WEEKDAY(a) >= 5 THEN 0
               ELSE GREATEST(0, LEAST(work_end, GREATEST(work_start, TIME_TO_SEC(TIME(a)))) - work_start) END;

    -- Business seconds from the reference Monday to `b`.
    SET bb =
        (DATEDIFF(DATE(b), '2000-01-03') DIV 7) * 5 * day_len
        + LEAST(DATEDIFF(DATE(b), '2000-01-03') MOD 7, 5) * day_len
        + CASE WHEN WEEKDAY(b) >= 5 THEN 0
               ELSE GREATEST(0, LEAST(work_end, GREATEST(work_start, TIME_TO_SEC(TIME(b)))) - work_start) END;

    RETURN bb - ba;
END$$

DELIMITER ;
