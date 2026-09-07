package com.temnet.temnet_parser.analytics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Any OpenAI-compatible chat-completions endpoint — Gemini, Groq, OpenRouter,
 * Anthropic's compatibility layer, self-hosted servers. Calls are paced to
 * the runtime {@code requestsPerMinute} so the free tiers' limits are never
 * tripped; the model name is a runtime setting too.
 */
public final class OpenAiCompatibleChat implements LlmChat {

    private static final Logger log = LoggerFactory.getLogger(OpenAiCompatibleChat.class);

    /**
     * Generous, because "thinking" models spend completion tokens on
     * reasoning before the one-word answer; the payload is tiny either way.
     */
    private static final int MAX_COMPLETION_TOKENS = 1024;

    private final String chatCompletionsUrl;
    private final String apiKey;
    private final Supplier<LlmSettings> runtime;
    private final CallPacer pacer = new CallPacer();
    private final HttpClient http;
    private final JsonMapper json = JsonMapper.builder().build();

    public OpenAiCompatibleChat(String baseUrl, String apiKey, String proxy, Supplier<LlmSettings> runtime) {
        this.chatCompletionsUrl = baseUrl.strip().replaceAll("/+$", "") + "/chat/completions";
        this.apiKey = apiKey == null ? "" : apiKey;
        this.runtime = runtime;

        // Some providers (Groq among them) are unreachable from some regions,
        // and the JDK http client ignores the Windows system proxy — so the
        // proxy the rest of the machine uses must be configured explicitly.
        HttpClient.Builder builder = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10));
        if (proxy != null && !proxy.isBlank()) {
            int colon = proxy.lastIndexOf(':');
            builder.proxy(ProxySelector.of(new InetSocketAddress(
                    proxy.substring(0, colon), Integer.parseInt(proxy.substring(colon + 1)))));
        }
        this.http = builder.build();

        if (this.apiKey.isBlank()) {
            log.warn("LLM_API_KEY не задан: запросы к {} будут отклоняться, кандидаты останутся pending.",
                    chatCompletionsUrl);
        }
    }

    @Override
    public boolean enabled() {
        return true;
    }

    @Override
    public String kind() {
        return "http";
    }

    @Override
    public String describe() {
        return runtime.get().model() + " at " + chatCompletionsUrl;
    }

    @Override
    public Map<String, Object> telemetry() {
        Map<String, Object> t = new LinkedHashMap<>();
        t.put("endpoint", chatCompletionsUrl);
        t.put("hasApiKey", !apiKey.isBlank());
        return t;
    }

    @Override
    public String complete(String systemPrompt, String userText) throws Exception {
        LlmSettings s = runtime.get();
        if (!s.enabled()) {
            throw new LlmUnavailableException("классификация поставлена на паузу");
        }
        ObjectNode body = json.createObjectNode();
        body.put("model", s.model());
        body.put("max_tokens", MAX_COMPLETION_TOKENS);
        body.put("temperature", 0);
        ArrayNode messages = body.putArray("messages");
        messages.addObject().put("role", "system").put("content", systemPrompt);
        messages.addObject().put("role", "user").put("content", userText);

        HttpRequest.Builder request = HttpRequest.newBuilder()
                .uri(URI.create(chatCompletionsUrl))
                .timeout(Duration.ofSeconds(60))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body), StandardCharsets.UTF_8));
        if (!apiKey.isBlank()) {
            request.header("Authorization", "Bearer " + apiKey);
        }

        pacer.await(s.requestsPerMinute());
        HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() / 100 != 2) {
            throw new IllegalStateException("LLM API returned HTTP " + response.statusCode()
                    + ": " + CallPacer.head(response.body()));
        }
        JsonNode content = json.readTree(response.body())
                .path("choices").path(0).path("message").path("content");
        if (content.isMissingNode() || content.isNull()) {
            throw new IllegalStateException("LLM API response has no message content: "
                    + CallPacer.head(response.body()));
        }
        return content.asString().strip();
    }
}
