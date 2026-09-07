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
            Тебе дают последние сообщения клиента из предыдущей (уже закрытой) заявки и его новое
            обращение, отправленное вскоре после закрытия. Определи, вернулась ли ТА ЖЕ САМАЯ
            проблема: то, что в предыдущей заявке считалось решённым, не сработало или сломалось снова.
            SAME — только если речь о том же самом объекте (тот же пациент, документ, номер, принтер,
            учётная запись, компьютер) и той же неисправности: «не помогло», «опять не печатает»,
            «снова не заходит».
            NEW — во всех остальных случаях, в том числе когда тема та же, но объект другой:
            другой пациент или номер, другой документ, другой принтер, ещё одна карта, новая
            учётная запись. Однотипная работа по новому случаю — это новая заявка, а не повтор.
            Если сомневаешься — NEW.
            Ответь строго одним словом: SAME или NEW.""";

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
     * Writes cached verdicts back onto pending candidates. A rebuild recreates
     * every ticket as pending; this is a plain DB update that costs nothing,
     * so it runs on every sync whether or not the provider is enabled - a
     * paused LLM must not make paid verdicts vanish from the metrics.
     */
    public int restoreCached() {
        int restored = analytics.update("""
                UPDATE ticket t
                JOIN llm_verdict v ON v.client = t.client AND v.opened_at = t.opened_at
                SET t.reopen_llm = v.verdict
                WHERE t.reopen_llm = 'pending'
                """);
        if (restored > 0) {
            log.info("LLM reopen verdicts restored from cache: {}", restored);
        }
        return restored;
    }

    /** Classifies up to {@code budget} pending candidates with the provider. */
    public Result classifyPending(int budget) {
        if (!chat.enabled() || budget <= 0) {
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
        // The END of the previous ticket is what the closure resolved; its
        // opening message may be days and several topics away.
        String previousTexts = TicketTexts.inboundLast(analytics, candidate.client(),
                candidate.prevOpened(), candidate.prevClosed());
        String newTexts = TicketTexts.inbound(analytics, candidate.client(), candidate.openedAt(), null);

        long startedAt = System.currentTimeMillis();
        String answer = chat.complete(SYSTEM_PROMPT, "Предыдущая заявка (закрыта):\n" + previousTexts
                + "\n\nНовое обращение:\n" + newTexts);
        stats.recordCall(System.currentTimeMillis() - startedAt);
        return parseVerdict(answer);
    }

    /**
     * The verdict is the FIRST word of the answer; anything else - including
     * "NEW, it is not the SAME issue" - counts as NEW: conservative and final.
     */
    static String parseVerdict(String answer) {
        if (answer == null) {
            return "new";
        }
        String first = answer.strip().split("\\s+", 2)[0].replaceAll("^\\P{L}+|\\P{L}+$", "");
        return first.equalsIgnoreCase("SAME") ? "same" : "new";
    }
}
