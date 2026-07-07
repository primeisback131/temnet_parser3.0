package com.temnet.temnet_parser.analytics;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Classifies AMBIGUOUS reopen candidates with an LLM: tickets opened shortly
 * after the same client's previous ticket was closed, but with no marker
 * words and no category match (reopen_llm = 'pending'). The model answers
 * whether the new request is the same issue (SAME) or a different one (NEW).
 *
 * Disabled unless an API key is configured (app.llm.api-key /
 * ANTHROPIC_API_KEY). Verdicts are cached in `llm_verdict` by the ticket's
 * natural identity (client + opened_at), so full rebuilds never re-classify
 * — and re-pay for — already-decided cases. At most
 * {@code app.llm.max-per-sync} API calls per sync run, paced to
 * {@code app.llm.requests-per-minute} (default 5, the Anthropic free-tier
 * limit) so a sync run never trips the rate limiter.
 */
@Service
public class LlmReopenClassifier {

    private static final Logger log = LoggerFactory.getLogger(LlmReopenClassifier.class);

    /** Max characters of each side's text sent to the model. */
    private static final int MAX_TEXT_CHARS = 600;

    private static final String SYSTEM_PROMPT = """
            Ты — классификатор обращений в службу технической поддержки.
            Тебе дают тексты предыдущей (уже закрытой) заявки клиента и его нового обращения,
            отправленного вскоре после закрытия. Определи, является ли новое обращение
            продолжением той же проблемы (повторное обращение по тому же вопросу) или это
            другая, новая проблема.
            Ответь строго одним словом: SAME — та же проблема, NEW — другая проблема.""";

    private final JdbcTemplate analytics;
    private final String model;
    private final int maxPerSync;
    /** Minimum spacing between API calls; 0 disables pacing. */
    private final long minCallIntervalMillis;
    private long earliestNextCallAt = 0;
    private final AnthropicClient client; // null when no API key is configured

    public LlmReopenClassifier(
            @Qualifier("analyticsJdbcTemplate") JdbcTemplate analytics,
            @Value("${app.llm.api-key:}") String apiKey,
            @Value("${app.llm.model:claude-haiku-4-5}") String model,
            @Value("${app.llm.max-per-sync:20}") int maxPerSync,
            @Value("${app.llm.requests-per-minute:5}") int requestsPerMinute) {
        this.analytics = analytics;
        this.model = model;
        this.maxPerSync = maxPerSync;
        this.minCallIntervalMillis = requestsPerMinute > 0 ? 60_000L / requestsPerMinute : 0;
        this.client = apiKey == null || apiKey.isBlank()
                ? null
                : AnthropicOkHttpClient.builder().apiKey(apiKey).build();
        if (this.client == null) {
            log.info("LLM reopen classification disabled (no app.llm.api-key / ANTHROPIC_API_KEY)");
        }
    }

    public boolean enabled() {
        return client != null;
    }

    private record Candidate(long id, String client, LocalDateTime openedAt,
                             LocalDateTime prevOpened, LocalDateTime prevClosed) {
    }

    /** Classifies up to {@code maxPerSync} pending candidates; returns how many were decided. */
    public int classifyPending() {
        if (client == null) {
            return 0;
        }

        List<Candidate> pending = analytics.query("""
                        SELECT t.id, t.client, t.opened_at, p.opened_at AS prev_opened, p.closed_at AS prev_closed
                        FROM ticket t
                        JOIN ticket p ON p.id = t.reopened_from
                        WHERE t.reopen_llm = 'pending'
                        ORDER BY t.id
                        LIMIT ?
                        """,
                (rs, i) -> new Candidate(
                        rs.getLong("id"),
                        rs.getString("client"),
                        rs.getTimestamp("opened_at").toLocalDateTime(),
                        rs.getTimestamp("prev_opened").toLocalDateTime(),
                        rs.getTimestamp("prev_closed").toLocalDateTime()),
                maxPerSync);
        if (pending.isEmpty()) {
            return 0;
        }

        int decided = 0;
        int apiCalls = 0;
        for (Candidate candidate : pending) {
            String verdict = cachedVerdict(candidate);
            if (verdict == null) {
                try {
                    verdict = classify(candidate);
                    apiCalls++;
                } catch (Exception e) {
                    // Leave the rest pending; the next sync run retries.
                    log.warn("LLM classification stopped after {} calls: {}", apiCalls, e.getMessage());
                    break;
                }
                analytics.update(
                        "INSERT IGNORE INTO llm_verdict (client, opened_at, verdict) VALUES (?, ?, ?)",
                        candidate.client(), Timestamp.valueOf(candidate.openedAt()), verdict);
            }
            analytics.update("UPDATE ticket SET reopen_llm = ? WHERE id = ?", verdict, candidate.id());
            decided++;
        }
        if (decided > 0) {
            log.info("LLM reopen classification: {} decided ({} API calls, {} still pending)",
                    decided, apiCalls, Math.max(0, pending.size() - decided));
        }
        return decided;
    }

    private String cachedVerdict(Candidate candidate) {
        List<String> found = analytics.queryForList(
                "SELECT verdict FROM llm_verdict WHERE client = ? AND opened_at = ?",
                String.class, candidate.client(), Timestamp.valueOf(candidate.openedAt()));
        return found.isEmpty() ? null : found.get(0);
    }

    /**
     * Blocks until the next API call fits the configured requests-per-minute
     * budget (free tier: 5/min). Token limits (10K in / 4K out per minute)
     * are never the binding constraint here: each request is well under 2K
     * input tokens and 10 output tokens.
     */
    private void awaitRateLimit() {
        long wait = earliestNextCallAt - System.currentTimeMillis();
        if (wait > 0) {
            try {
                Thread.sleep(wait);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Interrupted while pacing LLM calls", e);
            }
        }
        earliestNextCallAt = System.currentTimeMillis() + minCallIntervalMillis;
    }

    private String classify(Candidate candidate) {
        String previousTexts = inboundTexts(candidate.client(), candidate.prevOpened(), candidate.prevClosed());
        String newTexts = inboundTexts(candidate.client(), candidate.openedAt(), null);

        awaitRateLimit();
        Message response = client.messages().create(MessageCreateParams.builder()
                .model(model)
                .maxTokens(10L)
                .system(SYSTEM_PROMPT)
                .addUserMessage("Предыдущая заявка (закрыта):\n" + previousTexts
                        + "\n\nНовое обращение:\n" + newTexts)
                .build());

        String answer = response.content().stream()
                .flatMap(block -> block.text().stream())
                .map(text -> text.text())
                .reduce("", String::concat)
                .strip()
                .toUpperCase();
        // Anything unparseable counts as NEW: conservative (not a reopen) and final.
        return answer.startsWith("SAME") ? "same" : "new";
    }

    /** First inbound messages of a ticket, oldest first, capped for token cost. */
    private String inboundTexts(String client, LocalDateTime from, LocalDateTime to) {
        List<Map<String, Object>> rows = to == null
                ? analytics.queryForList("""
                        SELECT txt FROM message
                        WHERE client = ? AND direction = 'in' AND created_at >= ?
                        ORDER BY created_at LIMIT 3
                        """, client, Timestamp.valueOf(from))
                : analytics.queryForList("""
                        SELECT txt FROM message
                        WHERE client = ? AND direction = 'in' AND created_at BETWEEN ? AND ?
                        ORDER BY created_at LIMIT 3
                        """, client, Timestamp.valueOf(from), Timestamp.valueOf(to));

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
