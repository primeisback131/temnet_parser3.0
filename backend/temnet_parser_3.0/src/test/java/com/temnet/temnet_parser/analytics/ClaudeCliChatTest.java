package com.temnet.temnet_parser.analytics;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The parts of the CLI transport that decide without spawning a process. */
class ClaudeCliChatTest {

    private static final String RATE_LIMIT_LINE = "{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"allowed\","
            + "\"resetsAt\":1788373800,\"rateLimitType\":\"five_hour\",\"isUsingOverage\":false,"
            + "\"unifiedWindows\":{\"five_hour\":{\"utilization\":0.28,\"resetsAt\":1788373800},"
            + "\"seven_day\":{\"utilization\":0.13,\"resetsAt\":1788382800}}}}";
    private static final String RESULT_LINE = "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,"
            + "\"result\":\"SAME\",\"total_cost_usd\":0.0003,\"num_turns\":1}";

    static final LlmSettings RUNTIME = new LlmSettings(true, "other", 60, 0, 0.5, 0.2, 10, "claude-haiku-4-5");

    private static ClaudeCliChat chat(Path dir) {
        return new ClaudeCliChat(new ClaudeCliChat.Settings("claude", dir, dir, Duration.ofMinutes(2)),
                () -> RUNTIME);
    }

    @Test
    void parsesResultAndUsageFromTheStream(@TempDir Path dir) {
        ClaudeCliChat.Outcome outcome = chat(dir).parseStream(
                "{\"type\":\"system\",\"subtype\":\"init\"}\n"
                        + "{\"type\":\"assistant\",\"message\":{}}\n"
                        + RATE_LIMIT_LINE + "\r\n"
                        + RESULT_LINE + "\n");

        assertNotNull(outcome);
        assertEquals("SAME", outcome.text());
        assertFalse(outcome.error());
        assertEquals("success", outcome.subtype());
        assertEquals(0.28, outcome.fiveHourUtilization());
        assertEquals(1788373800L, outcome.fiveHourResetsAt());
        assertEquals(0.13, outcome.sevenDayUtilization());
        assertFalse(outcome.usingOverage());
        assertEquals(0.0003, outcome.costUsd());
    }

    @Test
    void errorResultsAndNoiseAreHandled(@TempDir Path dir) {
        ClaudeCliChat chat = chat(dir);

        ClaudeCliChat.Outcome failed = chat.parseStream("Warning: something\n"
                + "{\"type\":\"result\",\"subtype\":\"error_during_execution\",\"is_error\":true,"
                + "\"result\":\"You've hit your limit\"}");
        assertNotNull(failed);
        assertTrue(failed.error());
        assertEquals("error_during_execution", failed.subtype());
        assertNull(failed.fiveHourUtilization());

        assertNull(chat.parseStream("not json at all\n{broken"));
        assertNull(chat.parseStream(""));
    }

    @Test
    void ceilingDependsOnWhetherTheOwnerIsBusy() {
        ClaudeCliChat.Reading reading = new ClaudeCliChat.Reading(0.35, 10_000, null, Instant.EPOCH);

        assertNull(ClaudeCliChat.ceilingBreach(null, 100, true, 0.5, 0.2), "no reading yet: allowed");
        assertNull(ClaudeCliChat.ceilingBreach(reading, 100, false, 0.5, 0.2), "35% < idle ceiling 50%");
        String breach = ClaudeCliChat.ceilingBreach(reading, 100, true, 0.5, 0.2);
        assertNotNull(breach, "35% >= busy ceiling 20%");
        assertTrue(breach.contains("35%") && breach.contains("20%"), breach);
        assertNull(ClaudeCliChat.ceilingBreach(reading, 10_000, true, 0.5, 0.2), "window has reset: allowed");
        assertNotNull(ClaudeCliChat.ceilingBreach(new ClaudeCliChat.Reading(0.5, 10_000, null, Instant.EPOCH),
                100, false, 0.5, 0.2), "exactly at the ceiling counts as reached");
    }

    @Test
    void telemetryNeverCallsTheModel(@TempDir Path dir) {
        // The command does not exist: the screen still gets an answer, with the failure as authError.
        ClaudeCliChat chat = new ClaudeCliChat(
                new ClaudeCliChat.Settings("claude-does-not-exist-" + System.nanoTime(), dir, dir, Duration.ofSeconds(5)),
                () -> RUNTIME);
        var t = chat.telemetry();
        assertEquals(false, t.get("loggedIn"));
        assertNotNull(t.get("authError"));
        assertNull(t.get("fiveHourUtilization"));
        assertEquals(0.5, t.get("ceilingNow"), "no recent transcript in the temp home: idle ceiling");
        assertEquals(false, t.get("ownerBusy"));
    }

    @Test
    void recentTranscriptMeansTheOwnerIsBusy(@TempDir Path home) throws IOException {
        Path projects = home.resolve("projects");
        Path session = projects.resolve("C--some-project").resolve("abc.jsonl");
        Files.createDirectories(session.getParent());
        Files.writeString(session, "{}");
        Instant now = Instant.now();

        assertTrue(ClaudeCliChat.recentTranscriptExists(projects, Duration.ofMinutes(10), now));

        Files.setLastModifiedTime(session, FileTime.from(now.minus(Duration.ofMinutes(30))));
        assertFalse(ClaudeCliChat.recentTranscriptExists(projects, Duration.ofMinutes(10), now));

        assertFalse(ClaudeCliChat.recentTranscriptExists(projects, Duration.ZERO, now), "window 0 disables detection");
        assertFalse(ClaudeCliChat.recentTranscriptExists(home.resolve("missing"), Duration.ofMinutes(10), now));
    }
}
