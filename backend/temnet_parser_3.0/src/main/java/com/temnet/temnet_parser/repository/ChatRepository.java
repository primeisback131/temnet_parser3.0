package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.ChatMessage;
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

    /** Chat history of the given group's clients; the end date is inclusive. */
    public List<ChatMessage> findHistory(LocalDate start, LocalDate end, String groupName) {
        return jdbcClient.sql(SQL)
                .param("groupName", groupName)
                .param("start", start)
                .param("endExclusive", end.plusDays(1))
                .query(new DataClassRowMapper<>(ChatMessage.class))
                .list();
    }
}
