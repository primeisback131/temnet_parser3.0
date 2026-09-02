package com.temnet.temnet_parser.support;

import java.util.regex.Pattern;

/**
 * Text signals the ticket state machine reads off a client's message that
 * arrives shortly after their previous ticket was closed: is it a bare
 * acknowledgement ("спасибо") that opens nothing, or does it say the problem
 * is back?
 */
public final class ReopenSignals {

    /** Words that say the previous problem is back; a standalone «нет» too. */
    private static final Pattern REOPEN_MARKERS = Pattern.compile(
            "опять|снова|не помог|та же|тот же|всё ещё|все еще|повторн|прежнему|так и не"
                    + "|не реш[её]н|не исправ|^нет[.!]*$");

    /** Words of a bare acknowledgement. */
    private static final Pattern ACK = Pattern.compile(
            "\\b(спасибо|спс|благодарю|благодарим|ок|окей|оки|хорошо|понял|поняла|понятно|принято|отлично"
                    + "|супер|ага|угу|да)\\b",
            Pattern.UNICODE_CHARACTER_CLASS);

    /** A negated phrase («не ок», «спасибо, не надо») is not an acknowledgement. */
    private static final Pattern NEGATION = Pattern.compile("\\bне\\b", Pattern.UNICODE_CHARACTER_CLASS);

    /** A message this short cannot describe a problem: "+", "ok", an emoji. */
    private static final int ACK_MAX_LENGTH = 5;

    private ReopenSignals() {
    }

    /** True when the text says the previous problem persists. */
    public static boolean isReopenMarker(String text) {
        return REOPEN_MARKERS.matcher(text.strip().toLowerCase()).find();
    }

    /**
     * True for a bare acknowledgement of a closure. A message carrying a
     * reopen marker or a negation is never one: «не помогло» is exactly ten
     * characters long and used to be swallowed by a pure length rule.
     */
    public static boolean isAck(String text) {
        String trimmed = text.strip();
        String lower = trimmed.toLowerCase();
        if (isReopenMarker(lower) || NEGATION.matcher(lower).find()) {
            return false;
        }
        return trimmed.length() <= ACK_MAX_LENGTH || ACK.matcher(lower).find();
    }
}
