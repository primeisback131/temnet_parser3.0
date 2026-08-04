package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.Company;
import com.temnet.temnet_parser.security.Scope;
import com.temnet.temnet_parser.support.SqlLoader;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.DataClassRowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public class CompanyRepository {

    private static final String SQL = SqlLoader.load("sql/companies.sql");

    private final JdbcClient jdbcClient;

    public CompanyRepository(@Qualifier("analyticsJdbcClient") JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public List<Company> findReport(LocalDate start, LocalDate end, Scope scope, List<String> visibleGroups) {
        if (scope.isEmpty()) {
            return List.of();
        }
        String sql = SQL
                .replace("${scopeFilter}", ScopeSql.groupList("cg.grp", visibleGroups, scope.unrestricted()))
                .replace("${scopeMessages}", ScopeSql.messages("m", scope))
                .replace("${scopeTickets}", ScopeSql.tickets("t", scope))
                .replace("${backlogBoundary}", DataHorizon.CAPPED_END);
        // The end date is inclusive: half-open [start, end+1day) interval.
        var spec = ScopeSql.bind(jdbcClient.sql(sql)
                .param("start", start)
                .param("endExclusive", end.plusDays(1)), scope);
        if (!scope.unrestricted() && !visibleGroups.isEmpty()) {
            spec = spec.param("visibleGroups", visibleGroups);
        }
        return spec.query(new DataClassRowMapper<>(Company.class)).list();
    }
}
