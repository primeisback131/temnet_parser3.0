package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.ChatMessage;
import com.temnet.temnet_parser.security.Scope;
import com.temnet.temnet_parser.support.SqlLoader;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.DataClassRowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public class ChatRepository {

    private static final String SQL = SqlLoader.load("sql/chat.sql");

    private final JdbcClient jdbcClient;

    public ChatRepository(@Qualifier("analyticsJdbcClient") JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    /** Chat history within the caller's scope; the end date is inclusive. */
    public List<ChatMessage> findHistory(LocalDate start, LocalDate end, Scope scope) {
        if (scope.isEmpty()) {
            return List.of();
        }
        String sql = SQL.replace("${scopeMessages}", ScopeSql.messages("m", scope));
        return ScopeSql.bind(jdbcClient.sql(sql)
                        .param("start", start)
                        .param("endExclusive", end.plusDays(1)), scope)
                .query(new DataClassRowMapper<>(ChatMessage.class))
                .list();
    }
}
