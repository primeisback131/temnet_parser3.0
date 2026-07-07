package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.Backlog;
import com.temnet.temnet_parser.dto.BacklogTicket;
import com.temnet.temnet_parser.dto.Bucket;
import com.temnet.temnet_parser.dto.CategoryCount;
import com.temnet.temnet_parser.dto.HeatmapCell;
import com.temnet.temnet_parser.dto.MetricPoint;
import com.temnet.temnet_parser.dto.OperatorStat;
import com.temnet.temnet_parser.dto.ResolutionPoint;
import com.temnet.temnet_parser.dto.SlaPoint;
import com.temnet.temnet_parser.support.BusinessTime;
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
    private static final String BACKLOG_SQL = SqlLoader.load("sql/backlog.sql");

    // Outlier guards, in WORKING seconds (must match the 10-hour business day
    // of BusinessTime): first responses over one working day and resolutions
    // over five working days are treated as mis-pairings and dropped.
    private static final int MAX_FRT_SECONDS = 10 * 3600;
    private static final int MAX_RESOLUTION_SECONDS = 5 * 10 * 3600;

    private final JdbcClient analytics;

    public MetricsRepository(@Qualifier("analyticsJdbcClient") JdbcClient analytics) {
        this.analytics = analytics;
    }

    /**
     * Message volume and ticket outcomes over time. The end date is treated
     * as inclusive (half-open {@code [start, end+1day)} interval).
     */
    public List<MetricPoint> timeseries(LocalDate start, LocalDate end, String groupName, Bucket bucket) {
        boolean hasGroup = hasGroup(groupName);

        String sql = TIMESERIES_SQL
                .replace("${bucketMessages}", bucket.expression("m.created_at"))
                .replace("${bucketClosed}", bucket.expression("t.closed_at"))
                .replace("${bucketInProgress}", bucket.expression("t.in_progress_at"))
                .replace("${membershipMessages}", membership("m", hasGroup))
                .replace("${membershipTickets}", membership("t", hasGroup));

        return withRange(sql, start, end, hasGroup ? groupName : null)
                .query(new DataClassRowMapper<>(MetricPoint.class)).list();
    }

    /** Message counts bucketed by weekday (0=Mon) and hour of day. */
    public List<HeatmapCell> heatmap(LocalDate start, LocalDate end, String groupName) {
        boolean hasGroup = hasGroup(groupName);

        String sql = HEATMAP_SQL.replace("${membership}", membership("m", hasGroup));

        return withRange(sql, start, end, hasGroup ? groupName : null)
                .query(new DataClassRowMapper<>(HeatmapCell.class)).list();
    }

    /** First-response time (working seconds) per time bucket. */
    public List<SlaPoint> sla(LocalDate start, LocalDate end, String groupName, Bucket bucket) {
        boolean hasGroup = hasGroup(groupName);

        String sql = SLA_SQL
                .replace("${bucket}", bucket.expression("t.opened_at"))
                .replace("${groupFilter}", clientInGroup("t", hasGroup));

        return withRange(sql, start, end, hasGroup ? groupName : null)
                .param("maxFrtSeconds", MAX_FRT_SECONDS)
                .query(new DataClassRowMapper<>(SlaPoint.class)).list();
    }

    /** Ticket resolution time (working seconds) per time bucket. */
    public List<ResolutionPoint> resolution(LocalDate start, LocalDate end, String groupName, Bucket bucket) {
        boolean hasGroup = hasGroup(groupName);

        String sql = RESOLUTION_SQL
                .replace("${bucket}", bucket.expression("t.closed_at"))
                .replace("${groupFilter}", clientInGroup("t", hasGroup));

        return withRange(sql, start, end, hasGroup ? groupName : null)
                .param("maxResolutionSeconds", MAX_RESOLUTION_SECONDS)
                .query(new DataClassRowMapper<>(ResolutionPoint.class)).list();
    }

    /** Ticket counts per problem category. */
    public List<CategoryCount> categories(LocalDate start, LocalDate end, String groupName) {
        boolean hasGroup = hasGroup(groupName);

        String sql = CATEGORIES_SQL.replace("${groupFilter}", clientInGroup("t", hasGroup));

        return withRange(sql, start, end, hasGroup ? groupName : null)
                .query(new DataClassRowMapper<>(CategoryCount.class)).list();
    }

    /** Per-operator leaderboard for the period (optionally limited to a group's clients). */
    public List<OperatorStat> operators(LocalDate start, LocalDate end, String groupName) {
        boolean hasGroup = hasGroup(groupName);

        String sql = OPERATORS_SQL
                .replace("${groupFilterMessages}", clientInGroup("m", hasGroup))
                .replace("${groupFilterTickets}", clientInGroup("t", hasGroup));

        return withRange(sql, start, end, hasGroup ? groupName : null)
                .param("maxReplySeconds", MAX_FRT_SECONDS)
                .query(new DataClassRowMapper<>(OperatorStat.class)).list();
    }

    /** Open tickets as of the freshest ingested message. */
    public Backlog backlog(String groupName) {
        boolean hasGroup = hasGroup(groupName);

        LocalDateTime asOf = analytics.sql("SELECT MAX(created_at) FROM message")
                .query((rs, i) -> {
                    Timestamp ts = rs.getTimestamp(1);
                    return ts == null ? null : ts.toLocalDateTime();
                })
                .list()
                .get(0);
        if (asOf == null) {
            return new Backlog(null, List.of());
        }

        String sql = BACKLOG_SQL.replace("${groupFilter}", clientInGroup("t", hasGroup));

        var spec = analytics.sql(sql);
        if (hasGroup) {
            spec = spec.param("groupName", groupName);
        }
        List<BacklogTicket> tickets = spec.query((rs, i) -> {
            LocalDateTime openedAt = rs.getTimestamp("opened_at").toLocalDateTime();
            Timestamp firstResponse = rs.getTimestamp("first_response_at");
            return new BacklogTicket(
                    rs.getString("client"),
                    rs.getString("groups"),
                    rs.getString("category"),
                    openedAt,
                    rs.getTimestamp("last_activity").toLocalDateTime(),
                    firstResponse == null ? null : firstResponse.toLocalDateTime(),
                    rs.getInt("messages_in"),
                    rs.getInt("messages_out"),
                    BusinessTime.secondsBetween(openedAt, asOf));
        }).list();

        return new Backlog(asOf, tickets);
    }

    private JdbcClient.StatementSpec withRange(String sql, LocalDate start, LocalDate end, String groupName) {
        var spec = analytics.sql(sql)
                .param("start", start)
                .param("endExclusive", end.plusDays(1));
        if (groupName != null) {
            spec = spec.param("groupName", groupName);
        }
        return spec;
    }

    private static boolean hasGroup(String groupName) {
        return groupName != null && !groupName.isBlank();
    }

    /**
     * Membership scope for message/ticket volume queries: only clients that
     * belong to a real company group, each row counted once (EXISTS, no join
     * multiplication for clients in several groups).
     */
    private static String membership(String alias, boolean hasGroup) {
        return "AND EXISTS (SELECT 1 FROM client_group cg WHERE cg.client = " + alias
                + ".client AND cg.grp NOT LIKE 'help%' AND cg.grp <> 'all'"
                + (hasGroup ? " AND cg.grp = :groupName" : "") + ")";
    }

    /** Optional group filter for ticket-level queries. */
    private static String clientInGroup(String alias, boolean hasGroup) {
        return hasGroup
                ? "AND EXISTS (SELECT 1 FROM client_group cg WHERE cg.client = " + alias
                        + ".client AND cg.grp = :groupName)"
                : "";
    }
}
