package com.temnet.temnet_parser.analytics;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The database-free parts: validation, provider resolution, overlaying saved values. */
class LlmSettingsServiceTest {

    private static final LlmSettings BASE = new LlmSettings(true, "other", 60, 20, 0.5, 0.2, 10, "claude-haiku-4-5");

    private static LlmSettingsService.Override saved(String value) {
        return new LlmSettingsService.Override(value, LocalDateTime.now(), "admin");
    }

    @Test
    void validationRejectsNonsense() {
        assertThrows(IllegalArgumentException.class, () -> new LlmSettings(true, "maybe", 60, 20, 0.5, 0.2, 10, "m"));
        assertThrows(IllegalArgumentException.class, () -> new LlmSettings(true, "other", -1, 20, 0.5, 0.2, 10, "m"));
        assertThrows(IllegalArgumentException.class, () -> new LlmSettings(true, "other", 60, 20, 1.5, 0.2, 10, "m"));
        assertThrows(IllegalArgumentException.class, () -> new LlmSettings(true, "other", 60, 20, 0.5, 0, 10, "m"));
        assertThrows(IllegalArgumentException.class, () -> new LlmSettings(true, "other", 60, 20, 0.5, 0.2, -5, "m"));
        assertThrows(IllegalArgumentException.class, () -> new LlmSettings(true, "other", 60, 20, 0.5, 0.2, 10, " "));
        assertEquals("all", new LlmSettings(true, " ALL ", 60, 20, 0.5, 0.2, 10, "m").categories());
        assertEquals(0, new LlmSettings(false, "off", 0, 0, 1, 1, 0, "m").maxPerSync(), "zeros are allowed");
    }

    @Test
    void providerKindFollowsTheOldRules() {
        assertEquals("off", LlmSettingsService.providerKind("", ""));
        assertEquals("http", LlmSettingsService.providerKind("", "https://api.groq.com/openai/v1"));
        assertEquals("claude-cli", LlmSettingsService.providerKind(" Claude-CLI ", ""));
        assertEquals("off", LlmSettingsService.providerKind("off", "https://x"));
    }

    @Test
    void savedValuesOverlayTheDefaults() {
        LlmSettings result = LlmSettingsService.overlay(BASE, Map.of(
                LlmSettingsService.KEY_ENABLED, saved("false"),
                LlmSettingsService.KEY_MAX_PER_SYNC, saved(" 120 "),
                LlmSettingsService.KEY_CEILING_BUSY, saved("0.35"),
                LlmSettingsService.KEY_MODEL, saved("claude-sonnet-5")));

        assertFalse(result.enabled());
        assertEquals(120, result.maxPerSync());
        assertEquals(0.35, result.ceilingBusy());
        assertEquals("claude-sonnet-5", result.model());
        assertEquals(20, result.requestsPerMinute(), "untouched keys keep the default");
        assertEquals("other", result.categories());
    }

    @Test
    void anInvalidSavedValueLeavesTheDefaultsInForce() {
        LlmSettings result = LlmSettingsService.overlay(BASE, Map.of(
                LlmSettingsService.KEY_MAX_PER_SYNC, saved("lots")));
        assertEquals(BASE, result);

        LlmSettings outOfRange = LlmSettingsService.overlay(BASE, Map.of(
                LlmSettingsService.KEY_CEILING_IDLE, saved("7")));
        assertEquals(BASE, outOfRange);
        assertTrue(outOfRange.enabled());
    }
}
