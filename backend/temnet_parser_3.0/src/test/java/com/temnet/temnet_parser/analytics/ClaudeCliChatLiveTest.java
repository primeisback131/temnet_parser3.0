package com.temnet.temnet_parser.analytics;

import com.temnet.temnet_parser.support.CategoryRules;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Talks to the real Claude Code CLI on this machine's subscription. Off by
 * default: run with {@code CLAUDE_CLI_LIVE=1} after {@code claude auth login}.
 * Costs three short Haiku calls from the subscription's window.
 */
@EnabledIfEnvironmentVariable(named = "CLAUDE_CLI_LIVE", matches = "1")
class ClaudeCliChatLiveTest {

    /** Ceilings at 100% so the test itself is never paused by the owner's usage. */
    static final LlmSettings RUNTIME = new LlmSettings(true, "other", 60, 0, 1.0, 1.0, 10, "claude-haiku-4-5");

    static ClaudeCliChat liveChat(Path dir) {
        return new ClaudeCliChat(new ClaudeCliChat.Settings("claude", dir,
                Path.of(System.getProperty("user.home"), ".claude"), Duration.ofMinutes(2)), () -> RUNTIME);
    }

    @Test
    void classifiesThroughTheCli(@TempDir Path dir) throws Exception {
        ClaudeCliChat chat = liveChat(dir);

        String reopen = chat.complete(LlmReopenClassifier.SYSTEM_PROMPT,
                "Предыдущая заявка (закрыта):\nне печатает принтер на втором этаже, горит красная лампочка"
                        + "\n\nНовое обращение:\nопять не печатает, та же красная лампочка");
        assertEquals("same", LlmReopenClassifier.parseVerdict(reopen), reopen);

        String category = chat.complete(LlmCategoryClassifier.SYSTEM_PROMPT,
                "Текст обращения:\nдобрый день, у нас на втором этаже перестал печатать принтер, горит красная лампочка");
        assertEquals("Печать", LlmCategoryClassifier.parseCategory(category), category);

        // Ambiguous on purpose (1С or Доступ): the answer must at least be a real category.
        String ambiguous = chat.complete(LlmCategoryClassifier.SYSTEM_PROMPT,
                "Текст обращения:\nне могу зайти в 1С, пишет неверный пароль");
        String parsed = LlmCategoryClassifier.parseCategory(ambiguous);
        assertTrue(CategoryRules.names().contains(parsed) && !CategoryRules.OTHER.equals(parsed), ambiguous);

        Map<String, Object> t = chat.telemetry();
        assertEquals(true, t.get("loggedIn"), String.valueOf(t.get("authError")));
        assertNotNull(t.get("fiveHourUtilization"), "the usage reading comes with every call");
        System.out.println("Claude CLI live: " + chat.usageSummary() + ", telemetry " + t);
    }
}
