package com.temnet.temnet_parser.analytics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.nio.file.Path;
import java.time.Duration;

/**
 * Picks the model transport from configuration. {@code app.llm.provider}:
 * <ul>
 *   <li>{@code claude-cli} — the local Claude Code CLI on the owner's
 *       subscription ({@link ClaudeCliChat});</li>
 *   <li>{@code http} — an OpenAI-compatible endpoint, needs
 *       {@code app.llm.base-url} ({@link OpenAiCompatibleChat});</li>
 *   <li>{@code off} — no classification;</li>
 *   <li>empty (default) — {@code http} when a base url is set, otherwise off,
 *       which keeps older configurations working unchanged.</li>
 * </ul>
 * The transport itself is fixed for the process (it depends on what the
 * machine has: a CLI login, an API key); everything tunable at runtime comes
 * from {@link LlmSettingsService}.
 */
@Configuration
public class LlmChatConfig {

    private static final Logger log = LoggerFactory.getLogger(LlmChatConfig.class);

    @Bean
    public LlmChat llmChat(
            LlmSettingsService settings,
            @Value("${app.llm.base-url:}") String baseUrl,
            @Value("${app.llm.api-key:}") String apiKey,
            @Value("${app.llm.proxy:}") String proxy,
            @Value("${app.llm.claude-cli.command:claude}") String cliCommand,
            @Value("${app.llm.claude-cli.work-dir:}") String cliWorkDir,
            @Value("${app.llm.claude-cli.home:}") String cliHome,
            @Value("${app.llm.claude-cli.timeout:PT2M}") Duration cliTimeout) {
        String kind = settings.providerKind();
        LlmChat chat = switch (kind) {
            case "off" -> LlmChat.DISABLED;
            case "http" -> {
                if (baseUrl.isBlank()) {
                    throw new IllegalArgumentException("app.llm.provider=http needs app.llm.base-url (LLM_BASE_URL)");
                }
                yield new OpenAiCompatibleChat(baseUrl, apiKey, proxy, settings::current);
            }
            case "claude-cli" -> new ClaudeCliChat(new ClaudeCliChat.Settings(
                    cliCommand,
                    cliWorkDir.isBlank()
                            ? Path.of(System.getProperty("java.io.tmpdir"), "temnet-claude-cli")
                            : Path.of(cliWorkDir),
                    cliHome.isBlank() ? defaultClaudeHome() : Path.of(cliHome),
                    cliTimeout), settings::current);
            default -> throw new IllegalArgumentException(
                    "Unknown app.llm.provider '" + kind + "': use claude-cli, http or off");
        };
        if (chat.enabled()) {
            log.info("LLM classification provider: {}", chat.describe());
        } else {
            log.info("LLM classification disabled (LLM_PROVIDER is off and no LLM_BASE_URL)");
        }
        return chat;
    }

    /** Where Claude Code keeps its state: CLAUDE_CONFIG_DIR, else ~/.claude. */
    private static Path defaultClaudeHome() {
        String configured = System.getenv("CLAUDE_CONFIG_DIR");
        return configured != null && !configured.isBlank()
                ? Path.of(configured)
                : Path.of(System.getProperty("user.home"), ".claude");
    }
}
