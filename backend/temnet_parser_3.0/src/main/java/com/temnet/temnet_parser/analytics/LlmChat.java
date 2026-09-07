package com.temnet.temnet_parser.analytics;

import java.util.Map;

/**
 * One-shot chat completion as the classifiers use it: a fixed system prompt,
 * one user text, a short answer. Implementations differ only in how the
 * model is reached — an OpenAI-compatible HTTP endpoint or the local Claude
 * Code CLI running on a subscription — and in how they pace themselves.
 * Runtime knobs (model, pacing, ceilings) come from {@link LlmSettings} on
 * every call, so a change on the maintenance screen applies at once.
 */
public interface LlmChat {

    /** False when no provider is configured; classifiers then do nothing. */
    boolean enabled();

    /** {@code claude-cli}, {@code http} or {@code off}. */
    String kind();

    /** Provider and model, for logs and startup warnings. */
    String describe();

    /**
     * Returns the model's answer text.
     *
     * @throws LlmUnavailableException when the provider must not be called
     *         right now (usage ceiling reached, not logged in): the caller
     *         stops the batch quietly and retries on the next run
     * @throws Exception on any other failure of this one call
     */
    String complete(String systemPrompt, String userText) throws Exception;

    /**
     * Provider-specific state for the maintenance screen (subscription usage,
     * login, endpoint). Cheap to call; never makes a model call.
     */
    default Map<String, Object> telemetry() {
        return Map.of();
    }

    /** The no-provider implementation. */
    LlmChat DISABLED = new LlmChat() {
        @Override
        public boolean enabled() {
            return false;
        }

        @Override
        public String kind() {
            return "off";
        }

        @Override
        public String describe() {
            return "disabled";
        }

        @Override
        public String complete(String systemPrompt, String userText) {
            throw new IllegalStateException("LLM is disabled");
        }
    };
}
