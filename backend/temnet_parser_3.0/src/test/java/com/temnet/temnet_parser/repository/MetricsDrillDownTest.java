package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.Bucket;
import com.temnet.temnet_parser.dto.ClientMessages;
import com.temnet.temnet_parser.dto.MetricPoint;
import com.temnet.temnet_parser.dto.PeriodSummary;
import com.temnet.temnet_parser.dto.TicketDetail;
import com.temnet.temnet_parser.security.Scope;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.function.Predicate;
import java.util.function.ToLongFunction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * A card on the metrics screen opens the rows it was counted from, so the rows
 * must add up to the card exactly. Runs against the configured analytics DB;
 * on an empty one (CI) the checks are skipped, not passed as 0 == 0.
 */
@SpringBootTest
class MetricsDrillDownTest {

    private static final LocalDate START = LocalDate.of(2026, 1, 1);
    private static final LocalDate END = LocalDate.of(2026, 6, 30);

    @Autowired
    private MetricsRepository metrics;

    @Autowired
    @Qualifier("analyticsJdbcClient")
    private JdbcClient analytics;

    @Test
    void openedTicketsAddUpToTheSummary() {
        PeriodSummary s = metrics.summary(START, END, Scope.all());
        assumeTrue(s.opened() > 0, "no tickets in the analytics DB");
        List<TicketDetail> rows = metrics.ticketDetails(START, END, Scope.all(), false).tickets();

        assertThat((long) rows.size()).isEqualTo(s.opened());
        assertThat(count(rows, r -> r.status().equals("closed"))).isEqualTo(s.closed());
        assertThat(count(rows, r -> r.status().equals("rejected"))).isEqualTo(s.rejected());
        assertThat(count(rows, r -> r.status().equals("expired"))).isEqualTo(s.expired());
        assertThat(count(rows, r -> r.status().equals("open"))).isEqualTo(s.stillOpen());
        assertThat(count(rows, r -> r.noReply() && !r.status().equals("open"))).isEqualTo(s.unanswered());
        assertThat(count(rows, TicketDetail::answered)).isEqualTo(s.answered());
        assertThat(count(rows, TicketDetail::answeredFast)).isEqualTo(s.answeredFast());
        assertThat(count(rows, TicketDetail::answeredHour)).isEqualTo(s.answeredHour());
        assertThat(count(rows, TicketDetail::resolved)).isEqualTo(s.resolved());
        assertThat(count(rows, TicketDetail::resolvedHour)).isEqualTo(s.resolvedHour());
        assertThat(count(rows, TicketDetail::resolvedDay)).isEqualTo(s.resolvedDay());
        assertThat(count(rows, TicketDetail::thanked)).isEqualTo(s.thanked());
    }

    @Test
    void closedTicketsAddUpToTheTimeseries() {
        List<MetricPoint> points = metrics.timeseries(START, END, Scope.all(), Bucket.MONTH);
        assumeTrue(sum(points, MetricPoint::closed) > 0, "no closures in the analytics DB");
        List<TicketDetail> rows = metrics.ticketDetails(START, END, Scope.all(), true).tickets();

        assertThat(count(rows, r -> r.status().equals("closed"))).isEqualTo(sum(points, MetricPoint::closed));
        assertThat(count(rows, r -> r.status().equals("rejected"))).isEqualTo(sum(points, MetricPoint::rejected));
        assertThat(rows).allMatch(r -> r.status().equals("closed") || r.status().equals("rejected"));
    }

    @Test
    void clientMessagesAddUpToTheCards() {
        List<MetricPoint> points = metrics.timeseries(START, END, Scope.all(), Bucket.MONTH);
        PeriodSummary s = metrics.summary(START, END, Scope.all());
        assumeTrue(s.incoming() > 0, "no messages in the analytics DB");
        List<ClientMessages> rows = metrics.clientMessages(START, END, Scope.all());

        assertThat(sum(rows, r -> r.messagesIn() + r.messagesOut())).isEqualTo(sum(points, MetricPoint::messages));
        assertThat(sum(rows, ClientMessages::messagesIn)).isEqualTo(s.incoming());
        assertThat(sum(rows, r -> r.offHoursNight() + r.offHoursWeekend())).isEqualTo(s.offHours());
    }

    private static long count(List<TicketDetail> rows, Predicate<TicketDetail> test) {
        return rows.stream().filter(test).count();
    }

    private static <T> long sum(List<T> rows, ToLongFunction<T> value) {
        return rows.stream().mapToLong(value).sum();
    }

    /**
     * A desk sees whether a client came back to IT, not to another desk: the
     * repeat ticket is another desk's work (2026-09-28, the flag ignored scope).
     */
    @Test
    void reopenedIgnoresRepeatsOnAnotherDesk() {
        assertReopenedOnDesk("<>", false);
    }

    /** The positive case: a scope that zeroes the flag must not pass as "no leak". */
    @Test
    void reopenedSeesRepeatsOnTheSameDesk() {
        assertReopenedOnDesk("=", true);
    }

    /** A ticket whose repeat went to the same (`=`) or another (`<>`) desk, seen by its own desk. */
    private void assertReopenedOnDesk(String repeatDesk, boolean expected) {
        record Pair(String account, String client, LocalDateTime openedAt) {
        }
        String otherDesk = repeatDesk.equals("=") ? "<>" : "=";
        List<Pair> pairs = analytics.sql("""
                        SELECT b.account, b.client, b.opened_at
                        FROM ticket b
                        JOIN ticket r ON r.reopened_from = b.id
                        WHERE r.account %1$s b.account
                          AND (r.reopen_score > 0 OR r.reopen_llm = 'same')
                          AND NOT EXISTS (SELECT 1 FROM ticket s
                                          WHERE s.reopened_from = b.id AND s.account %2$s b.account
                                            AND (s.reopen_score > 0 OR s.reopen_llm = 'same'))
                        LIMIT 1
                        """.formatted(repeatDesk, otherDesk))
                .query((rs, i) -> new Pair(rs.getString(1), rs.getString(2), rs.getTimestamp(3).toLocalDateTime()))
                .list();
        assumeTrue(!pairs.isEmpty(), "no such repeat in the analytics DB");
        Pair p = pairs.get(0);
        LocalDate day = p.openedAt().toLocalDate();

        List<TicketDetail> rows =
                metrics.ticketDetails(day, day, Scope.of(List.of(p.account()), List.of()), false).tickets();

        assertThat(rows).filteredOn(r -> r.client().equals(p.client()) && r.openedAt().equals(p.openedAt()))
                .singleElement()
                .extracting(TicketDetail::reopened)
                .isEqualTo(expected);
    }
}
