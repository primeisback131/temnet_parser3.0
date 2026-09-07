package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.Alert;
import com.temnet.temnet_parser.dto.AlertsReport;
import com.temnet.temnet_parser.dto.BacklogReport;
import com.temnet.temnet_parser.dto.Bucket;
import com.temnet.temnet_parser.dto.CategoryCount;
import com.temnet.temnet_parser.dto.CategoryPoint;
import com.temnet.temnet_parser.dto.ClientStat;
import com.temnet.temnet_parser.dto.HeatmapCell;
import com.temnet.temnet_parser.dto.MetricPoint;
import com.temnet.temnet_parser.dto.OpenTicket;
import com.temnet.temnet_parser.dto.OperatorStat;
import com.temnet.temnet_parser.dto.PeriodSummary;
import com.temnet.temnet_parser.dto.ReopenPoint;
import com.temnet.temnet_parser.dto.ResolutionPoint;
import com.temnet.temnet_parser.dto.SlaPoint;
import com.temnet.temnet_parser.security.Scope;
import com.temnet.temnet_parser.support.SqlLoader;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.DataClassRowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * All metrics read the analytics DB (normalized `message` + `ticket` tables
 * maintained by the sync job); the raw ejabberd dump is only touched by the
 * sync itself.
 */
@Repository
public class MetricsRepository {

    private static final String TIMESERIES_SQL = SqlLoader.load("sql/timeseries.sql");
    private static final String HEATMAP_SQL = SqlLoader.load("sql/heatmap.sql");
    private static final String SLA_SQL = SqlLoader.load("sql/sla.sql");
    private static final String CATEGORIES_SQL = SqlLoader.load("sql/categories.sql");
    private static final String OPERATORS_SQL = SqlLoader.load("sql/operators.sql");
    private static final String RESOLUTION_SQL = SqlLoader.load("sql/resolution.sql");
    private static final String REOPENS_SQL = SqlLoader.load("sql/reopens.sql");
    private static final String BACKLOG_SQL = SqlLoader.load("sql/backlog.sql");
    private static final String BACKLOG_TICKETS_SQL = SqlLoader.load("sql/backlog_tickets.sql");
    private static final String SUMMARY_SQL = SqlLoader.load("sql/summary.sql");
    private static final String CLIENTS_SQL = SqlLoader.load("sql/clients.sql");
    private static final String CATEGORY_TIMESERIES_SQL = SqlLoader.load("sql/category_timeseries.sql");


    // Outlier guards, in WORKING seconds (must match the 10-hour business day
    // of BusinessTime): first responses over one working day and resolutions
    // over five working days are treated as mis-pairings and dropped.
    private static final int MAX_FRT_SECONDS = 10 * 3600;
    private static final int MAX_RESOLUTION_SECONDS = 5 * 10 * 3600;

    // Service-level thresholds the summary reports compliance against: a
    // first reply within 15 minutes / one hour, a closure within one working day.
    private static final int FAST_REPLY_SECONDS = 15 * 60;
    private static final int HOUR_REPLY_SECONDS = 3600;
    private static final int DAY_RESOLUTION_SECONDS = 10 * 3600;

    /** Rows of the frequent-clients list; enough to spot the pattern, not a report. */
    private static final int TOP_CLIENTS = 20;

    // Anomaly thresholds: a group alerts on >= 2x its weekly message baseline
    // (with a volume floor to skip tiny groups) or >= 2x its average first
    // response, with at least a handful of tickets in the week.
    private static final int SPIKE_MIN_MESSAGES = 30;
    private static final double SPIKE_RATIO = 2.0;
    private static final int SLA_MIN_TICKETS = 10;
    private static final double SLA_DEGRADATION_RATIO = 2.0;

    private final JdbcClient analytics;

    public MetricsRepository(@Qualifier("analyticsJdbcClient") JdbcClient analytics) {
        this.analytics = analytics;
    }

    /**
     * Message volume and ticket outcomes over time. The end date is treated
     * as inclusive (half-open {@code [start, end+1day)} interval).
     */
    public List<MetricPoint> timeseries(LocalDate start, LocalDate end, Scope scope, Bucket bucket) {

        String sql = TIMESERIES_SQL
                .replace("${bucketMessages}", bucket.expression("m.created_at"))
                .replace("${bucketClosed}", bucket.expression("t.closed_at"))
                .replace("${bucketOpened}", bucket.expression("t.opened_at"))
                .replace("${bucketResolved}", bucket.expression("COALESCE(t.closed_at, t.stale_at)"))
                .replace("${effectiveEnd}", DataHorizon.CAPPED_END)
                .replace("${membershipMessages}", ScopeSql.messages("m", scope))
                .replace("${membershipTickets}", ScopeSql.tickets("t", scope))
                .replace("${membershipBaseline}", ScopeSql.tickets("t", scope));

        return withRange(sql, start, end, scope)
                .query(new DataClassRowMapper<>(MetricPoint.class)).list();
    }

    /**
     * Tickets still open at the END of the period — the real backlog. Counted
     * against COALESCE(closed_at, stale_at), so tickets abandoned by silent
     * clients (which keep status 'open', expiry being lazy) do not inflate it.
     * The boundary is capped at the data horizon; the returned {@code asOf}
     * says which moment the answer describes.
     */
    public BacklogReport backlog(LocalDate end, Scope scope) {

        String sql = BACKLOG_SQL.replace("${membership}", ScopeSql.tickets("t", scope));

        return ScopeSql.bind(analytics.sql(sql).param("endExclusive", end.plusDays(1)), scope)
                .query(new DataClassRowMapper<>(BacklogReport.class)).single();
    }

    /** The individual tickets behind {@link #backlog}, for manual checking. */
    public List<OpenTicket> backlogTickets(LocalDate end, Scope scope) {

        String sql = BACKLOG_TICKETS_SQL
                .replace("${effectiveEnd}", DataHorizon.CAPPED_END)
                .replace("${membership}", ScopeSql.tickets("t", scope));

        return ScopeSql.bind(analytics.sql(sql).param("endExclusive", end.plusDays(1)), scope)
                .query(new DataClassRowMapper<>(OpenTicket.class)).list();
    }

    /** Message counts bucketed by weekday (0=Mon) and hour of day. */
    public List<HeatmapCell> heatmap(LocalDate start, LocalDate end, Scope scope) {

        String sql = HEATMAP_SQL.replace("${membership}", ScopeSql.messages("m", scope));

        return withRange(sql, start, end, scope)
                .query(new DataClassRowMapper<>(HeatmapCell.class)).list();
    }

    /** First-response time (working seconds) per time bucket. */
    public List<SlaPoint> sla(LocalDate start, LocalDate end, Scope scope, Bucket bucket) {

        String anchor = nextWorkingDay("t.opened_at");
        String sql = SLA_SQL
                .replace("${bucket}", bucket.expression(anchor))
                .replace("${anchor}", anchor)
                .replace("${groupFilter}", ScopeSql.tickets("t", scope));

        return withRange(sql, start, end, scope)
                .param("maxFrtSeconds", MAX_FRT_SECONDS)
                .query(new DataClassRowMapper<>(SlaPoint.class)).list();
    }

    /** Ticket resolution time (working seconds) per time bucket. */
    public List<ResolutionPoint> resolution(LocalDate start, LocalDate end, Scope scope, Bucket bucket) {

        String anchor = nextWorkingDay("t.closed_at");
        String sql = RESOLUTION_SQL
                .replace("${bucket}", bucket.expression(anchor))
                .replace("${anchor}", anchor)
                .replace("${groupFilter}", ScopeSql.tickets("t", scope));

        return withRange(sql, start, end, scope)
                .param("maxResolutionSeconds", MAX_RESOLUTION_SECONDS)
                .query(new DataClassRowMapper<>(ResolutionPoint.class)).list();
    }

    /**
     * Quality summary of the tickets opened in the period (outcomes, unanswered,
     * threshold compliance, weight, thanks, handoffs, new clients) plus the
     * off-hours share of incoming messages. Always exactly one row.
     */
    public PeriodSummary summary(LocalDate start, LocalDate end, Scope scope) {

        String sql = SUMMARY_SQL
                .replace("${effectiveEnd}", DataHorizon.CAPPED_END)
                .replace("${groupFilter}", ScopeSql.tickets("t", scope))
                .replace("${membershipMessages}", ScopeSql.messages("m", scope));

        return withRange(sql, start, end, scope)
                .param("maxFrtSeconds", MAX_FRT_SECONDS)
                .param("fastReplySeconds", FAST_REPLY_SECONDS)
                .param("hourReplySeconds", HOUR_REPLY_SECONDS)
                .param("maxResolutionSeconds", MAX_RESOLUTION_SECONDS)
                .param("dayResolutionSeconds", DAY_RESOLUTION_SECONDS)
                .query(new DataClassRowMapper<>(PeriodSummary.class)).single();
    }

    /** Clients with the most tickets opened in the period. */
    public List<ClientStat> clients(LocalDate start, LocalDate end, Scope scope) {

        String sql = CLIENTS_SQL.replace("${groupFilter}", ScopeSql.tickets("t", scope));

        return withRange(sql, start, end, scope)
                .param("limit", TOP_CLIENTS)
                .query(new DataClassRowMapper<>(ClientStat.class)).list();
    }

    /** Ticket counts per problem category, with the category's typical cost. */
    public List<CategoryCount> categories(LocalDate start, LocalDate end, Scope scope) {

        String sql = CATEGORIES_SQL
                .replace("${effectiveEnd}", DataHorizon.CAPPED_END)
                .replace("${groupFilter}", ScopeSql.tickets("t", scope));

        return withRange(sql, start, end, scope)
                .param("maxFrtSeconds", MAX_FRT_SECONDS)
                .param("maxResolutionSeconds", MAX_RESOLUTION_SECONDS)
                .query(new DataClassRowMapper<>(CategoryCount.class)).list();
    }

    /** Tickets per category per time bucket (by opening date). */
    public List<CategoryPoint> categoryTimeseries(LocalDate start, LocalDate end, Scope scope, Bucket bucket) {

        String sql = CATEGORY_TIMESERIES_SQL
                .replace("${bucket}", bucket.expression("t.opened_at"))
                .replace("${groupFilter}", ScopeSql.tickets("t", scope));

        return withRange(sql, start, end, scope)
                .query(new DataClassRowMapper<>(CategoryPoint.class)).list();
    }

    /** Per-operator leaderboard for the period (optionally limited to a group's clients). */
    public List<OperatorStat> operators(LocalDate start, LocalDate end, Scope scope) {

        String sql = OPERATORS_SQL
                .replace("${groupFilterMessages}", ScopeSql.messages("m", scope))
                .replace("${groupFilterTickets}", ScopeSql.tickets("t", scope));

        return withRange(sql, start, end, scope)
                .param("maxReplySeconds", MAX_FRT_SECONDS)
                .query(new DataClassRowMapper<>(OperatorStat.class)).list();
    }

    /** Repeat requests (probable/confirmed reopens) vs closures per bucket. */
    public List<ReopenPoint> reopens(LocalDate start, LocalDate end, Scope scope, Bucket bucket) {

        String sql = REOPENS_SQL
                .replace("${bucketClosed}", bucket.expression("t.closed_at"))
                .replace("${bucketOpened}", bucket.expression("t.opened_at"))
                .replace("${groupFilter}", ScopeSql.tickets("t", scope));

        return withRange(sql, start, end, scope)
                .query(new DataClassRowMapper<>(ReopenPoint.class)).list();
    }

    /**
     * Anomalies in the last 7 days of ingested data against the preceding
     * 8 weeks: per-group message spikes and first-response degradation.
     */
    public AlertsReport alerts() {
        LocalDateTime asOf = analytics.sql("SELECT MAX(created_at) FROM message")
                .query((rs, i) -> {
                    Timestamp ts = rs.getTimestamp(1);
                    return ts == null ? null : ts.toLocalDateTime();
                })
                .list()
                .get(0);
        if (asOf == null) {
            return new AlertsReport(null, null, List.of());
        }
        LocalDateTime weekStart = asOf.minusDays(7);
        LocalDateTime baselineStart = weekStart.minusWeeks(8);

        List<Alert> alerts = new java.util.ArrayList<>();

        alerts.addAll(analytics.sql("""
                        SELECT cg.grp AS group_name,
                               SUM(m.created_at >= :weekStart)       AS current_count,
                               SUM(m.created_at < :weekStart) / 8.0  AS baseline
                        FROM message m
                        JOIN client_group cg ON cg.client = m.client
                        WHERE m.created_at >= :baselineStart
                          AND cg.grp NOT LIKE 'help%' AND cg.grp <> 'all'
                        GROUP BY cg.grp
                        HAVING current_count >= :minMessages
                           AND baseline > 0
                           AND current_count >= :spikeRatio * baseline
                        """)
                .param("weekStart", weekStart)
                .param("baselineStart", baselineStart)
                .param("minMessages", SPIKE_MIN_MESSAGES)
                .param("spikeRatio", SPIKE_RATIO)
                .query((rs, i) -> {
                    double current = rs.getDouble("current_count");
                    double baseline = rs.getDouble("baseline");
                    return new Alert("message_spike", rs.getString("group_name"), current, baseline,
                            round1(current / baseline));
                })
                .list());

        alerts.addAll(analytics.sql("""
                        SELECT cg.grp AS group_name,
                               AVG(IF(t.opened_at >= :weekStart, t.frt_seconds, NULL)) AS current_avg,
                               AVG(IF(t.opened_at < :weekStart, t.frt_seconds, NULL))  AS baseline_avg,
                               SUM(t.opened_at >= :weekStart)                          AS current_count
                        FROM ticket t
                        JOIN client_group cg ON cg.client = t.client
                        WHERE t.opened_at >= :baselineStart
                          AND t.frt_seconds IS NOT NULL AND t.frt_seconds <= :maxFrtSeconds
                          AND cg.grp NOT LIKE 'help%' AND cg.grp <> 'all'
                        GROUP BY cg.grp
                        HAVING current_count >= :minTickets
                           AND baseline_avg IS NOT NULL AND baseline_avg > 0
                           AND current_avg >= :degradationRatio * baseline_avg
                        """)
                .param("weekStart", weekStart)
                .param("baselineStart", baselineStart)
                .param("maxFrtSeconds", MAX_FRT_SECONDS)
                .param("minTickets", SLA_MIN_TICKETS)
                .param("degradationRatio", SLA_DEGRADATION_RATIO)
                .query((rs, i) -> {
                    double current = rs.getDouble("current_avg");
                    double baseline = rs.getDouble("baseline_avg");
                    return new Alert("sla_degradation", rs.getString("group_name"), current, baseline,
                            round1(current / baseline));
                })
                .list());

        alerts.sort(java.util.Comparator.comparingDouble(Alert::ratio).reversed());
        return new AlertsReport(asOf, weekStart, alerts);
    }

    private static double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private JdbcClient.StatementSpec withRange(String sql, LocalDate start, LocalDate end, Scope scope) {
        return ScopeSql.bind(analytics.sql(sql).param("start", start).param("endExclusive", end.plusDays(1)), scope);
    }


    /**
     * Membership scope for message/ticket volume queries: only clients that
     * belong to a real company group, each row counted once (EXISTS, no join
     * multiplication for clients in several groups).
     */

    /**
     * The given datetime column shifted off weekends to the next Monday.
     * Weekends are officially non-working (see BusinessTime), so a ticket
     * opened or closed on Saturday/Sunday belongs to the working day where
     * its working time actually runs; otherwise the tiny weekend samples
     * (Monday-queue waits and week-spillover closures) show up as misleading
     * weekend peaks on the time charts.
     */
    private static String nextWorkingDay(String column) {
        return "(" + column + " + INTERVAL (CASE WEEKDAY(" + column
                + ") WHEN 5 THEN 2 WHEN 6 THEN 1 ELSE 0 END) DAY)";
    }

    /** Optional group filter for ticket-level queries. */
}
