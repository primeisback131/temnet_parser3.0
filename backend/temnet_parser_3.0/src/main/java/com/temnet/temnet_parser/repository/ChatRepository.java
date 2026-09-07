package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.ChatMessage;
import com.temnet.temnet_parser.dto.ChatParticipant;
import com.temnet.temnet_parser.dto.ChatTicket;
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

    private static final String HISTORY_SQL = SqlLoader.load("sql/chat.sql");
    private static final String PARTICIPANTS_SQL = SqlLoader.load("sql/chat_participants.sql");
    private static final String TICKETS_SQL = SqlLoader.load("sql/chat_tickets.sql");

    private final JdbcClient jdbcClient;

    public ChatRepository(@Qualifier("analyticsJdbcClient") JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    /**
     * Chat history within the caller's scope; the end date is inclusive.
     * With a {@code client} only that client's conversation is returned.
     */
    public List<ChatMessage> findHistory(LocalDate start, LocalDate end, Scope scope, String client) {
        if (scope.isEmpty()) {
            return List.of();
        }
        boolean single = client != null && !client.isBlank();
        String sql = HISTORY_SQL
                .replace("${clientFilter}", single ? "AND m.client = :client" : "")
                .replace("${scopeMessages}", ScopeSql.messages("m", scope));
        var spec = ScopeSql.bind(jdbcClient.sql(sql)
                .param("start", start)
                .param("endExclusive", end.plusDays(1)), scope);
        if (single) {
            spec = spec.param("client", client);
        }
        return spec.query(new DataClassRowMapper<>(ChatMessage.class)).list();
    }

    /** Clients with at least one message in the period, freshest first, with a preview. */
    public List<ChatParticipant> findParticipants(LocalDate start, LocalDate end, Scope scope) {
        if (scope.isEmpty()) {
            return List.of();
        }
        String sql = PARTICIPANTS_SQL.replace("${scopeMessages}", ScopeSql.messages("m", scope));
        return ScopeSql.bind(jdbcClient.sql(sql)
                        .param("start", start)
                        .param("endExclusive", end.plusDays(1)), scope)
                .query(new DataClassRowMapper<>(ChatParticipant.class))
                .list();
    }

    /** One client's tickets overlapping the period, for the markers in the conversation. */
    public List<ChatTicket> findTickets(LocalDate start, LocalDate end, Scope scope, String client) {
        if (scope.isEmpty()) {
            return List.of();
        }
        String sql = TICKETS_SQL.replace("${scopeTickets}", ScopeSql.tickets("t", scope));
        return ScopeSql.bind(jdbcClient.sql(sql)
                        .param("start", start)
                        .param("endExclusive", end.plusDays(1))
                        .param("client", client), scope)
                .query(new DataClassRowMapper<>(ChatTicket.class))
                .list();
    }
}
