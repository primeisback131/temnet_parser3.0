package com.temnet.temnet_parser.support;

import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;

/** Loads SQL statements stored as classpath resources under {@code sql/}. */
public final class SqlLoader {

    private SqlLoader() {
    }

    public static String load(String location) {
        try {
            return new ClassPathResource(location).getContentAsString(StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to load SQL resource: " + location, e);
        }
    }
}
