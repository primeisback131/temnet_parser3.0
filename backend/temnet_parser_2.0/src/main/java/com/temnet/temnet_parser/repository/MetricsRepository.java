package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.Bucket;
import com.temnet.temnet_parser.dto.HeatmapCell;
import com.temnet.temnet_parser.dto.MetricPoint;
import com.temnet.temnet_parser.dto.SlaPoint;
import com.temnet.temnet_parser.support.SqlLoader;
import org.springframework.jdbc.core.DataClassRowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public class MetricsRepository {

    private static final String TIMESERIES_SQL = SqlLoader.load("sql/timeseries.sql");
    private static final String HEATMAP_SQL = SqlLoader.load("sql/heatmap.sql");
    private static final String SLA_SQL = SqlLoader.load("sql/sla.sql");

    // Replies later than this are treated as overnight/cross-session, not a
    // first response, and excluded from the average (8 hours).
    private static final int MAX_FRT_SECONDS = 8 * 3600;

    private final JdbcClient jdbcClient;

    public MetricsRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    /**
     * Aggregate message/request counts over time. The end date is treated as
     * inclusive: rows up to the end of that day are counted (half-open
     * {@code [start, end+1day)} interval).
     */
    public List<MetricPoint> timeseries(LocalDate start, LocalDate end, String groupName, Bucket bucket) {
        boolean hasGroup = groupName != null && !groupName.isBlank();

        // Tokens are code-controlled (enum expression + fixed clause); the group
        // value itself is passed as a bound parameter, so there is no injection.
        String sql = TIMESERIES_SQL
                .replace("${bucket}", bucket.expression("archive.created_at"))
                .replace("${groupFilter}", groupFilter(hasGroup));

        var spec = jdbcClient.sql(sql)
                .param("start", start)
                .param("endExclusive", end.plusDays(1));
        if (hasGroup) {
            spec = spec.param("groupName", groupName);
        }

        return spec.query(new DataClassRowMapper<>(MetricPoint.class)).list();
    }

    /** Message counts bucketed by weekday (0=Mon) and hour of day. */
    public List<HeatmapCell> heatmap(LocalDate start, LocalDate end, String groupName) {
        boolean hasGroup = groupName != null && !groupName.isBlank();

        String sql = HEATMAP_SQL.replace("${groupFilter}", groupFilter(hasGroup));

        var spec = jdbcClient.sql(sql)
                .param("start", start)
                .param("endExclusive", end.plusDays(1));
        if (hasGroup) {
            spec = spec.param("groupName", groupName);
        }

        return spec.query(new DataClassRowMapper<>(HeatmapCell.class)).list();
    }

    /** Average first-response time (seconds) per time bucket. */
    public List<SlaPoint> sla(LocalDate start, LocalDate end, String groupName, Bucket bucket) {
        boolean hasGroup = groupName != null && !groupName.isBlank();

        // The SLA query has no sr_group join, so a group is matched by the
        // client (non-help party) being a member of that group.
        String filter = hasGroup
                ? """
                  AND EXISTS (SELECT 1 FROM sr_user su
                              WHERE SUBSTRING_INDEX(su.jid, '@', 1) =
                                    CASE WHEN username LIKE '%help%'
                                         THEN SUBSTRING_INDEX(peer, '@', 1)
                                         ELSE username END
                                AND su.grp = :groupName)
                  """
                : "";

        String sql = SLA_SQL
                .replace("${bucket}", bucket.expression("created_at"))
                .replace("${groupFilter}", filter);

        var spec = jdbcClient.sql(sql)
                .param("start", start)
                .param("endExclusive", end.plusDays(1))
                .param("maxFrtSeconds", MAX_FRT_SECONDS);
        if (hasGroup) {
            spec = spec.param("groupName", groupName);
        }

        return spec.query(new DataClassRowMapper<>(SlaPoint.class)).list();
    }

    private static String groupFilter(boolean hasGroup) {
        return hasGroup ? "AND sr_group.name = :groupName" : "";
    }
}
