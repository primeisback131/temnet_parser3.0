package com.temnet.temnet_parser.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * archive.created_at is a TIMESTAMP: MariaDB hands it out in the SESSION
 * zone, so the dump connection must pin that zone or every machine reads
 * its own wall clock and the working-hour metrics drift between them.
 */
@SpringBootTest
class DumpTimeZoneTest {

    @Autowired
    private JdbcClient jdbcClient;

    @Value("${app.dump.timezone}")
    private String configured;

    @Test
    void dumpSessionUsesTheConfiguredZone() {
        String session = jdbcClient.sql("SELECT @@time_zone").query(String.class).single();
        assertEquals(configured, session);
    }
}
