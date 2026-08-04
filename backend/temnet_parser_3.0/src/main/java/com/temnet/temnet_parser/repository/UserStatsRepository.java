package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.UserStat;
import com.temnet.temnet_parser.support.SqlLoader;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.DataClassRowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public class UserStatsRepository {

    private static final String SQL = SqlLoader.load("sql/users.sql");

    private final JdbcClient jdbcClient;

    public UserStatsRepository(@Qualifier("analyticsJdbcClient") JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public List<UserStat> findReport(LocalDate start, LocalDate end, String groupName,
                                     com.temnet.temnet_parser.security.Scope scope) {
        if (scope.isEmpty()) {
            return List.of();
        }
        // The end date is inclusive: half-open [start, end+1day) interval.
        // Open-ticket counts additionally cap the boundary at the data horizon,
        // exactly as /metrics/backlog does — otherwise the same period shows a
        // number here and zero there.
        String sql = SQL
                .replace("${backlogBoundary}", DataHorizon.CAPPED_END)
                .replace("${scopeMessages}", ScopeSql.messages("m", scope))
                .replace("${scopeTickets}", ScopeSql.tickets("t", scope));
        return ScopeSql.bind(jdbcClient.sql(sql)
                        .param("start", start)
                        .param("endExclusive", end.plusDays(1))
                        .param("groupName", groupName), scope)
                .query(new DataClassRowMapper<>(UserStat.class))
                .list();
    }
}
