package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.UserStat;
import com.temnet.temnet_parser.support.SqlLoader;
import org.springframework.jdbc.core.DataClassRowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public class UserStatsRepository {

    private static final String SQL = SqlLoader.load("sql/users.sql");

    private final JdbcClient jdbcClient;

    public UserStatsRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public List<UserStat> findReport(LocalDate start, LocalDate end, String groupName) {
        return jdbcClient.sql(SQL)
                .param("start", start)
                .param("end", end)
                .param("groupName", groupName)
                .query(new DataClassRowMapper<>(UserStat.class))
                .list();
    }
}
