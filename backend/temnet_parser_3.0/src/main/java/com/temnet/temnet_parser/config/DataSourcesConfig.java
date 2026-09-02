package com.temnet.temnet_parser.config;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.JdbcTransactionManager;

import javax.sql.DataSource;

/**
 * Two databases: the ejabberd dump (read-only source, the app's default
 * datasource — touched only by the sync job) and the analytics DB owned by
 * this app (normalized messages + tickets, accounts), which serves every
 * request.
 *
 * Defining the beans manually because Spring Boot's single-datasource
 * auto-configuration backs off as soon as a second {@link DataSource} exists.
 * The analytics pool is the busy one: a dashboard load fires eight queries at
 * once, so its size is configurable and defaults well above the source pool.
 */
@Configuration
public class DataSourcesConfig {

    @Bean
    @Primary
    public DataSource dataSource(
            @Value("${spring.datasource.url}") String url,
            @Value("${spring.datasource.username}") String username,
            @Value("${spring.datasource.password}") String password,
            @Value("${spring.datasource.hikari.maximum-pool-size:4}") int poolSize,
            @Value("${spring.datasource.hikari.pool-name:temnet-pool}") String poolName) {
        return pool(url, username, password, poolSize, poolName);
    }

    @Bean
    @Primary
    public JdbcClient jdbcClient(DataSource dataSource) {
        return JdbcClient.create(dataSource);
    }

    @Bean
    public DataSource analyticsDataSource(
            @Value("${app.analytics.url}") String url,
            @Value("${app.analytics.username}") String username,
            @Value("${app.analytics.password}") String password,
            @Value("${app.analytics.pool-size:16}") int poolSize) {
        return pool(url, username, password, poolSize, "temnet-analytics");
    }

    @Bean
    public JdbcTemplate analyticsJdbcTemplate(@Qualifier("analyticsDataSource") DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }

    @Bean
    public JdbcClient analyticsJdbcClient(@Qualifier("analyticsDataSource") DataSource dataSource) {
        return JdbcClient.create(dataSource);
    }

    @Bean
    public JdbcTransactionManager analyticsTxManager(@Qualifier("analyticsDataSource") DataSource dataSource) {
        return new JdbcTransactionManager(dataSource);
    }

    private static HikariDataSource pool(String url, String user, String password, int maxSize, String name) {
        HikariDataSource ds = new HikariDataSource();
        ds.setJdbcUrl(url);
        ds.setUsername(user);
        ds.setPassword(password);
        ds.setMaximumPoolSize(maxSize);
        ds.setPoolName(name);
        return ds;
    }
}
