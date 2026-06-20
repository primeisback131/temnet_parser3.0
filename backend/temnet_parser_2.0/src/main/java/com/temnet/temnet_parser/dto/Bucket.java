package com.temnet.temnet_parser.dto;

/**
 * Time bucket for metric aggregation. Each value carries the SQL expression
 * that truncates {@code archive.created_at} to the start of the bucket.
 * The expressions are code-controlled (never user input), so they are safe
 * to inline into the query template.
 */
public enum Bucket {
    DAY("DATE(%1$s)"),
    WEEK("DATE(%1$s - INTERVAL WEEKDAY(%1$s) DAY)"),
    MONTH("DATE(DATE_FORMAT(%1$s, '%%Y-%%m-01'))");

    private final String template;

    Bucket(String template) {
        this.template = template;
    }

    /** SQL expression that truncates the given datetime column to the bucket start. */
    public String expression(String column) {
        return template.formatted(column);
    }

    /** Case-insensitive parse; falls back to {@link #DAY} for unknown values. */
    public static Bucket from(String value) {
        if (value == null || value.isBlank()) {
            return DAY;
        }
        try {
            return valueOf(value.trim().toUpperCase());
        } catch (IllegalArgumentException ignored) {
            return DAY;
        }
    }
}
