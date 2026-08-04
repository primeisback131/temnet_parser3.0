package com.temnet.temnet_parser.support;

/**
 * Recognizes the operator phrase that ends a ticket — «заявка закрыта» /
 * «заявка отклонена» — the way it is really typed on the desk.
 *
 * <p>Operators type it by hand dozens of times a day, so it arrives misspelled
 * constantly: {@code закрыта заяка}, {@code закрыта заявкс}, {@code закрытазаявка},
 * {@code заявк закрыта}. An exact substring test leaves those tickets open
 * forever and inflates the backlog, so the phrase is matched fuzzily instead:
 * a закрыт-/отклонен- participle standing next to a word within one edit of
 * «заявка», glued or spaced.
 *
 * <p>Deliberately NOT matched, because on real traffic they are not closures:
 * the infinitive ({@code можно закрыть заявку?} — asking permission) and a
 * negated participle ({@code заявка не закрыта}).
 */
public final class ClosurePhrase {

    /** Ticket status written by a closing phrase; the values live in `ticket.status`. */
    public static final String CLOSED = "closed";
    public static final String REJECTED = "rejected";

    private static final String CLOSE_STEM = "закрыт";
    private static final String[] REJECT_STEMS = {"отклонен", "отклонён"};
    private static final String TICKET = "заявка";

    // How much of a participle ending may sit between the stem and a glued
    // «заявка» (закрытая заявка, закрытазаявка). Only letters count, so a
    // separate short word can never be skipped over.
    private static final int MAX_ENDING = 3;

    private ClosurePhrase() {
    }

    /**
     * Status this outgoing message puts the open ticket into, or {@code null}
     * when it closes nothing. A message carrying both phrases counts as closed.
     */
    public static String statusOf(String text) {
        String norm = normalize(text);
        if (hasPhrase(norm, CLOSE_STEM)) {
            return CLOSED;
        }
        for (String stem : REJECT_STEMS) {
            if (hasPhrase(norm, stem)) {
                return REJECTED;
            }
        }
        return null;
    }

    /** Lowercase; everything that is not a Cyrillic letter becomes a separator. */
    private static String normalize(String text) {
        String lower = text.toLowerCase();
        StringBuilder out = new StringBuilder(lower.length());
        for (int i = 0; i < lower.length(); i++) {
            char c = lower.charAt(i);
            out.append(c >= 'а' && c <= 'я' || c == 'ё' ? c : ' ');
        }
        return out.toString();
    }

    /** Is there a non-negated {@code stem} participle next to a «заявка» word? */
    private static boolean hasPhrase(String norm, String stem) {
        for (int at = norm.indexOf(stem); at >= 0; at = norm.indexOf(stem, at + 1)) {
            int endingAt = at + stem.length();
            if (endingAt < norm.length() && norm.charAt(endingAt) == 'ь') {
                continue; // «закрыть» — an offer to close, not a closure
            }
            String before = wordEndingAt(norm, at);
            if (before.equals("не")) {
                continue; // «заявка не закрыта»
            }
            if (isTicketWord(before)) {
                return true;
            }
            // The participle ending is unknown (and often mistyped), so try
            // every plausible cut of the letters right after the stem.
            int letters = 0;
            while (endingAt + letters < norm.length() && isLetter(norm.charAt(endingAt + letters))
                    && letters < MAX_ENDING) {
                letters++;
            }
            for (int skip = 0; skip <= letters; skip++) {
                if (isTicketWord(wordStartingAt(norm, endingAt + skip))) {
                    return true;
                }
            }
        }
        return false;
    }

    /** The run of letters ending right before {@code at}, blanks skipped. */
    private static String wordEndingAt(String norm, int at) {
        int end = at;
        while (end > 0 && norm.charAt(end - 1) == ' ') {
            end--;
        }
        int start = end;
        while (start > 0 && isLetter(norm.charAt(start - 1))) {
            start--;
        }
        return norm.substring(start, end);
    }

    /** The run of letters starting at {@code from}, blanks skipped. */
    private static String wordStartingAt(String norm, int from) {
        int start = from;
        while (start < norm.length() && norm.charAt(start) == ' ') {
            start++;
        }
        int end = start;
        while (end < norm.length() && isLetter(norm.charAt(end))) {
            end++;
        }
        return norm.substring(start, end);
    }

    private static boolean isLetter(char c) {
        return c >= 'а' && c <= 'я' || c == 'ё';
    }

    private static boolean isTicketWord(String word) {
        return withinOneEdit(word, TICKET);
    }

    /**
     * True when {@code a} is at most one insertion, deletion, substitution or
     * swap of adjacent letters away from {@code b} (Damerau-Levenshtein
     * distance ≤ 1). One edit is the whole tolerance on purpose: every Russian
     * word within one edit of «заявка» is another form of «заявка».
     */
    private static boolean withinOneEdit(String a, String b) {
        int la = a.length();
        int lb = b.length();
        if (Math.abs(la - lb) > 1) {
            return false;
        }
        int i = 0;
        while (i < la && i < lb && a.charAt(i) == b.charAt(i)) {
            i++;
        }
        if (i == la && i == lb) {
            return true;
        }
        if (la == lb) {
            return equalFrom(a, i + 1, b, i + 1)
                    || (i + 1 < la && a.charAt(i) == b.charAt(i + 1) && a.charAt(i + 1) == b.charAt(i)
                        && equalFrom(a, i + 2, b, i + 2));
        }
        String longer = la > lb ? a : b;
        String shorter = la > lb ? b : a;
        return equalFrom(longer, i + 1, shorter, i);
    }

    private static boolean equalFrom(String a, int ai, String b, int bi) {
        return a.regionMatches(ai, b, bi, a.length() - ai);
    }
}
