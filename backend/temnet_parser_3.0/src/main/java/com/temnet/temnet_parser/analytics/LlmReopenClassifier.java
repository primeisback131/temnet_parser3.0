package com.temnet.temnet_parser.analytics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Classifies AMBIGUOUS reopen candidates with an LLM: tickets opened shortly
 * after the same client's previous ticket was closed, but with no marker
 * words and no category match (reopen_llm = 'pending'). The model answers
 * whether the new request is the same issue (SAME) or a different one (NEW).
 * <p>
 * The transport ({@link LlmChat}) is configured separately; disabled means
 * candidates simply stay pending. Verdicts are cached in {@code llm_verdict}
 * by the ticket's natural identity (client + opened_at), so full rebuilds
 * never re-classify — and never re-pay for — already-decided cases: cached
 * verdicts are re-applied in bulk before any call is made.
 */
@Service
public class LlmReopenClassifier {

    private static final Logger log = LoggerFactory.getLogger(LlmReopenClassifier.class);

    /** How a run went: fresh decisions and the provider calls they cost. */
    public record Result(int decided, int calls) {
        static final Result NONE = new Result(0, 0);
    }

    static final String SYSTEM_PROMPT = """
            Ты — классификатор обращений в службу технической поддержки.
            Тебе дают тексты предыдущей (уже закрытой) заявки клиента и его нового обращения,
            отправленного вскоре после закрытия. Определи, является ли новое обращение
            продолжением той же проблемы (повторное обращение по тому же вопросу) или это
            другая, новая проблема.
            Ответь строго одним словом: SAME — та же проблема, NEW — другая проблема.""";

    private final JdbcTemplate analytics;
    private final LlmChat chat;
    private final LlmRunStats stats;
    private final int concurrency;

    public LlmReopenClassifier(@Qualifier("analyticsJdbcTemplate") JdbcTemplate analytics, LlmChat chat,
                               LlmRunStats stats, @Value("${app.llm.concurrency:4}") int concurrency) {
        this.analytics = analytics;
        this.chat = chat;
        this.stats = stats;
        this.concurrency = concurrency;
    }

    public boolean enabled() {
        return chat.enabled();
    }

    private record Candidate(long id, String client, LocalDateTime openedAt,
                             LocalDateTime prevOpened, LocalDateTime prevClosed) {
    }

    /**
     * Re-applies cached verdicts, then classifies up to {@code budget}
     * pending candidates with the provider.
     */
    public Result classifyPending(int budget) {
        if (!chat.enabled()) {
            return Result.NONE;
        }
        int restored = analytics.update("""
                UPDATE ticket t
                JOIN llm_verdict v ON v.client = t.client AND v.opened_at = t.opened_at
                SET t.reopen_llm = v.verdict
                WHERE t.reopen_llm = 'pending'
                """);
        if (restored > 0) {
            log.info("LLM reopen verdicts restored from cache: {}", restored);
        }
        if (budget <= 0) {
            return Result.NONE;
        }

        List<Candidate> pending = analytics.query("""
                        SELECT t.id, t.client, t.opened_at, p.opened_at AS prev_opened, p.closed_at AS prev_closed
                        FROM ticket t
                        JOIN ticket p ON p.id = t.reopened_from
                        WHERE t.reopen_llm = 'pending'
                        ORDER BY t.id DESC
                        LIMIT ?
                        """,
                (rs, i) -> new Candidate(
                        rs.getLong("id"),
                        rs.getString("client"),
                        rs.getTimestamp("opened_at").toLocalDateTime(),
                        rs.getTimestamp("prev_opened").toLocalDateTime(),
                        rs.getTimestamp("prev_closed").toLocalDateTime()),
                budget);
        if (pending.isEmpty()) {
            return Result.NONE;
        }

        ParallelCalls.Result run = ParallelCalls.run("reopen classification", pending, concurrency, candidate -> {
            String verdict = classify(candidate);
            analytics.update(
                    "INSERT IGNORE INTO llm_verdict (client, opened_at, verdict) VALUES (?, ?, ?)",
                    candidate.client(), Timestamp.valueOf(candidate.openedAt()), verdict);
            analytics.update("UPDATE ticket SET reopen_llm = ? WHERE id = ?", verdict, candidate.id());
        });
        int decided = run.decided();
        if (decided > 0) {
            log.info("LLM reopen classification: {} decided ({} still pending)", decided, pending.size() - decided);
        }
        stats.recordReopens(decided, decided, run.paused(), run.error());
        return new Result(decided, decided);
    }

    private String classify(Candidate candidate) throws Exception {
        String previousTexts = TicketTexts.inbound(analytics, candidate.client(),
                candidate.prevOpened(), candidate.prevClosed());
        String newTexts = TicketTexts.inbound(analytics, candidate.client(), candidate.openedAt(), null);

        long startedAt = System.currentTimeMillis();
        String answer = chat.complete(SYSTEM_PROMPT, "Предыдущая заявка (закрыта):\n" + previousTexts
                + "\n\nНовое обращение:\n" + newTexts);
        stats.recordCall(System.currentTimeMillis() - startedAt);
        return parseVerdict(answer);
    }

    /** Anything unparseable counts as NEW: conservative (not a reopen) and final. */
    static String parseVerdict(String answer) {
        return answer != null && answer.toUpperCase().contains("SAME") ? "same" : "new";
    }
}
