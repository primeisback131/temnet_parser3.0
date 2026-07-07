package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.Group;
import com.temnet.temnet_parser.support.SqlLoader;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.DataClassRowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class GroupRepository {

    private static final String SQL = SqlLoader.load("sql/groups.sql");

    private final JdbcClient jdbcClient;

    public GroupRepository(@Qualifier("analyticsJdbcClient") JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public List<Group> findAll() {
        return jdbcClient.sql(SQL)
                .query(new DataClassRowMapper<>(Group.class))
                .list();
    }
}
