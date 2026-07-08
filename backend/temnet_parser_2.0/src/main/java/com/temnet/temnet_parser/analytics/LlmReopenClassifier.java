package com.temnet.temnet_parser.analytics;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Classifies AMBIGUOUS reopen candidates with an LLM: tickets opened shortly
 * after the same client's previous ticket was closed, but with no marker
 * words and no category match (reopen_llm = 'pending'). The model answers
 * whether the new request is the same issue (SAME) or a different one (NEW).
 *
 * Talks to any OpenAI-compatible chat-completions endpoint — Gemini, Groq,
 * OpenRouter, Anthropic and self-hosted servers all expose one — selected by
 * {@code app.llm.base-url} (LLM_BASE_URL). Disabled while the base url is
 * empty. Verdicts are cached in `llm_verdict` by the ticket's natural
 * identity (client + opened_at), so full rebuilds never re-classify — and
 * with a paid provider never re-pay for — already-decided cases. Calls are
 * paced to {@code app.llm.requests-per-minute} and capped at
 * {@code app.llm.max-per-sync} per sync run so the LLM step fits inside the
 * sync interval and free-tier rate limits.
 */
@Service
public class LlmReopenClassifier {

    private static final Logger log = LoggerFactory.getLogger(LlmReopenClassifier.class);

    /** Max characters of each side's text sent to the model. */
    private static final int MAX_TEXT_CHARS = 600;

    /**
     * Generous, because "thinking" models spend completion tokens on
     * reasoning before the one-word answer; the payload is tiny either way.
     */
    private static final int MAX_COMPLETION_TOKENS = 1024;

    private static final String SYSTEM_PROMPT = """
            Ты — классификатор обращений в службу технической поддержки.
            Тебе дают тексты предыдущей (уже закрытой) заявки клиента и его нового обращения,
            отправленного вскоре после закрытия. Определи, является ли новое обращение
            продолжением той же проблемы (повторное обращение по тому же вопросу) или это
            другая, новая проблема.
            Ответь строго одним словом: SAME — та же проблема, NEW — другая проблема.""";

    private final JdbcTemplate analytics;
    private final String chatCompletionsUrl; // null when no base url is configured
    private final String apiKey;
    private final String model;
    private final int maxPerSync;
    /** Minimum spacing between API calls; 0 disables pacing. */
    private final long minCallIntervalMillis;
    private long earliestNextCallAt = 0;

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private final JsonMapper json = JsonMapper.builder().build();

    public LlmReopenClassifier(
            @Qualifier("analyticsJdbcTemplate") JdbcTemplate analytics,
            @Value("${app.llm.base-url:}") String baseUrl,
            @Value("${app.llm.api-key:}") String apiKey,
            @Value("${app.llm.model:gemini-flash-latest}") String model,
            @Value("${app.llm.max-per-sync:20}") int maxPerSync,
            @Value("${app.llm.requests-per-minute:5}") int requestsPerMinute) {
        this.analytics = analytics;
        this.apiKey = apiKey;
        this.model = model;
        this.maxPerSync = maxPerSync;
        this.minCallIntervalMillis = requestsPerMinute > 0 ? 60_000L / requestsPerMinute : 0;
        this.chatCompletionsUrl = baseUrl == null || baseUrl.isBlank()
                ? null
                : baseUrl.replaceAll("/+$", "") + "/chat/completions";
        if (this.chatCompletionsUrl == null) {
            log.info("LLM reopen classification disabled (no app.llm.base-url / LLM_BASE_URL)");
        }
    }

    public boolean enabled() {
        return chatCompletionsUrl != null;
    }

    private record Candidate(long id, String client, LocalDateTime openedAt,
                             LocalDateTime prevOpened, LocalDateTime prevClosed) {
    }

    /** Classifies up to {@code maxPerSync} pending candidates; returns how many were decided. */
    public int classifyPending() {
        if (chatCompletionsUrl == null) {
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
     * budget (free tiers: Gemini 10/min, Groq 30/min; the default 5 is safe
     * for any of them).
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

    private String classify(Candidate candidate) throws IOException, InterruptedException {
        String previousTexts = inboundTexts(candidate.client(), candidate.prevOpened(), candidate.prevClosed());
        String newTexts = inboundTexts(candidate.client(), candidate.openedAt(), null);

        String answer = chat("Предыдущая заявка (закрыта):\n" + previousTexts
                + "\n\nНовое обращение:\n" + newTexts);
        // Anything unparseable counts as NEW: conservative (not a reopen) and final.
        return answer.toUpperCase().contains("SAME") ? "same" : "new";
    }

    /** One OpenAI-compatible chat-completions call; returns the message text. */
    private String chat(String userText) throws IOException, InterruptedException {
        ObjectNode body = json.createObjectNode();
        body.put("model", model);
        body.put("max_tokens", MAX_COMPLETION_TOKENS);
        body.put("temperature", 0);
        ArrayNode messages = body.putArray("messages");
        messages.addObject().put("role", "system").put("content", SYSTEM_PROMPT);
        messages.addObject().put("role", "user").put("content", userText);

        HttpRequest.Builder request = HttpRequest.newBuilder()
                .uri(URI.create(chatCompletionsUrl))
                .timeout(Duration.ofSeconds(60))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body), StandardCharsets.UTF_8));
        if (!apiKey.isBlank()) {
            request.header("Authorization", "Bearer " + apiKey);
        }

        awaitRateLimit();
        HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() / 100 != 2) {
            throw new IllegalStateException("LLM API returned HTTP " + response.statusCode()
                    + ": " + head(response.body()));
        }
        JsonNode content = json.readTree(response.body())
                .path("choices").path(0).path("message").path("content");
        if (content.isMissingNode() || content.isNull()) {
            throw new IllegalStateException("LLM API response has no message content: " + head(response.body()));
        }
        return content.asString().strip();
    }

    private static String head(String body) {
        String flat = body == null ? "" : body.replaceAll("\\s+", " ").strip();
        return flat.length() <= 300 ? flat : flat.substring(0, 300) + "…";
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
