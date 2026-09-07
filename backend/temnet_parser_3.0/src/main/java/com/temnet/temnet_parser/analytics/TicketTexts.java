package com.temnet.temnet_parser.analytics;

import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/** What a ticket's client wrote, trimmed to what a classification prompt needs. */
final class TicketTexts {

    /** Max characters of one ticket's text sent to the model. */
    static final int MAX_TEXT_CHARS = 600;

    /** How many of the ticket's first client messages are looked at. */
    private static final int MAX_MESSAGES = 3;

    private TicketTexts() {
    }

    /**
     * The first inbound messages between {@code from} and {@code to} (open
     * end when {@code to} is null), oldest first, capped for token cost.
     */
    static String inbound(JdbcTemplate analytics, String client, LocalDateTime from, LocalDateTime to) {
        List<Map<String, Object>> rows = to == null
                ? analytics.queryForList("""
                        SELECT txt FROM message
                        WHERE client = ? AND direction = 'in' AND created_at >= ?
                        ORDER BY created_at LIMIT %d
                        """.formatted(MAX_MESSAGES), client, Timestamp.valueOf(from))
                : analytics.queryForList("""
                        SELECT txt FROM message
                        WHERE client = ? AND direction = 'in' AND created_at BETWEEN ? AND ?
                        ORDER BY created_at LIMIT %d
                        """.formatted(MAX_MESSAGES), client, Timestamp.valueOf(from), Timestamp.valueOf(to));

        StringBuilder sb = new StringBuilder();
        for (Map<String, Object> row : rows) {
            String txt = String.valueOf(row.get("txt"));
            if (sb.length() + txt.length() > MAX_TEXT_CHARS) {
                sb.append(txt, 0, Math.max(0, MAX_TEXT_CHARS - sb.length()));
                break;
            }
            if (sb.length() > 0) {
                sb.append('\n');
            }
            sb.append(txt);
        }
        return sb.isEmpty() ? "(текст недоступен)" : sb.toString();
    }
}
