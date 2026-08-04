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

    /**
     * Only the groups the caller may see — this list drives every picker.
     * Desks expand to the organizations they serve, so the list is the already
     * resolved set, not the raw grants.
     */
    public List<Group> findAll(List<String> visibleGroups, boolean unrestricted) {
        if (!unrestricted && visibleGroups.isEmpty()) {
            return List.of();
        }
        String sql = SQL.replace("${scopeFilter}",
                ScopeSql.groupList("grp", visibleGroups, unrestricted));
        var spec = jdbcClient.sql(sql);
        if (!unrestricted) {
            spec = spec.param("visibleGroups", visibleGroups);
        }
        return spec.query(new DataClassRowMapper<>(Group.class)).list();
    }
}
