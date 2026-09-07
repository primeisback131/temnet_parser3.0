package com.temnet.temnet_parser.analytics;

/**
 * Minimum spacing between provider calls. Shared by both transports so a
 * free-tier limit (Gemini 10/min, Groq 30/min) or a subscription's window
 * is never hammered; 0 requests per minute disables pacing. The rate is
 * passed per call because it is a runtime setting.
 */
final class CallPacer {

    private long earliestNextCallAt;

    /** Blocks until the next call fits the given budget. */
    synchronized void await(int requestsPerMinute) {
        long wait = earliestNextCallAt - System.currentTimeMillis();
        if (wait > 0) {
            try {
                Thread.sleep(wait);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Interrupted while pacing LLM calls", e);
            }
        }
        long minInterval = requestsPerMinute > 0 ? 60_000L / requestsPerMinute : 0;
        earliestNextCallAt = System.currentTimeMillis() + minInterval;
    }

    /** The first characters of a payload, single-line, for error messages. */
    static String head(String body) {
        String flat = body == null ? "" : body.replaceAll("\\s+", " ").strip();
        return flat.length() <= 300 ? flat : flat.substring(0, 300) + "…";
    }
}
