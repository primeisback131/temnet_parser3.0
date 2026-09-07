package com.temnet.temnet_parser.analytics;

import java.util.Locale;
import java.util.Set;

/**
 * The knobs of the LLM step an administrator may turn at runtime. The
 * environment supplies the defaults; values saved from the maintenance
 * screen override them and survive restarts ({@link LlmSettingsService}).
 *
 * @param enabled            whether the classifiers run at all (a pause switch)
 * @param categories         which tickets get a category from the model: other, all, off
 * @param maxPerSync         provider calls one run may spend, both classifiers together
 * @param requestsPerMinute  pacing of calls; 0 = no pacing
 * @param ceilingIdle        Claude CLI only: 5-hour window utilization (0..1] above which calls stop while the owner is not using Claude Code
 * @param ceilingBusy        Claude CLI only: the same while the owner is using Claude Code
 * @param busyWindowMinutes  Claude CLI only: a session transcript changed within this many minutes = the owner is busy; 0 disables the distinction
 * @param model              model name passed to the provider
 */
public record LlmSettings(
        boolean enabled,
        String categories,
        int maxPerSync,
        int requestsPerMinute,
        double ceilingIdle,
        double ceilingBusy,
        int busyWindowMinutes,
        String model) {

    public static final Set<String> CATEGORY_MODES = Set.of("other", "all", "off");

    public LlmSettings {
        categories = categories == null ? "other" : categories.strip().toLowerCase(Locale.ROOT);
        if (!CATEGORY_MODES.contains(categories)) {
            throw new IllegalArgumentException("Режим категорий должен быть other, all или off");
        }
        if (maxPerSync < 0 || maxPerSync > 5000) {
            throw new IllegalArgumentException("Лимит вызовов за прогон должен быть от 0 до 5000");
        }
        if (requestsPerMinute < 0 || requestsPerMinute > 600) {
            throw new IllegalArgumentException("Темп запросов должен быть от 0 до 600 в минуту");
        }
        if (!(ceilingIdle > 0 && ceilingIdle <= 1) || !(ceilingBusy > 0 && ceilingBusy <= 1)) {
            throw new IllegalArgumentException("Потолки загрузки окна должны быть от 1% до 100%");
        }
        if (busyWindowMinutes < 0 || busyWindowMinutes > 1440) {
            throw new IllegalArgumentException("Окно занятости должно быть от 0 до 1440 минут");
        }
        model = model == null ? "" : model.strip();
        if (model.isEmpty() || model.length() > 120) {
            throw new IllegalArgumentException("Модель должна быть указана (до 120 символов)");
        }
    }
}
