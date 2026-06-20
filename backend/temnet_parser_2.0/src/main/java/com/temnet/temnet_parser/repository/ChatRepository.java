package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.ChatMessage;
import com.temnet.temnet_parser.support.SqlLoader;
import org.springframework.jdbc.core.DataClassRowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public class ChatRepository {

    private static final String SQL = SqlLoader.load("sql/chat.sql");

    private final JdbcClient jdbcClient;

    public ChatRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public List<ChatMessage> findHistory(LocalDate start, LocalDate end, String username) {
        return jdbcClient.sql(SQL)
                .param("username", username)
                .param("start", start)
                .param("end", end)
                .query(new DataClassRowMapper<>(ChatMessage.class))
                .list();
    }
}
