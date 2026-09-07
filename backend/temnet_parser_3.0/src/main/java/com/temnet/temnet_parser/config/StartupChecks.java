package com.temnet.temnet_parser.config;

import com.temnet.temnet_parser.analytics.LlmChat;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Loud warnings for configuration that is fine on a developer machine and
 * dangerous anywhere else. The defaults stay convenient; this makes sure a
 * production log cannot miss them.
 */
@Configuration
public class StartupChecks {

    private static final Logger log = LoggerFactory.getLogger(StartupChecks.class);

    private static final String DEFAULT_DB_PASSWORD = "root";

    @Bean
    public ApplicationRunner warnAboutInsecureDefaults(
            @Value("${spring.datasource.password:}") String sourcePassword,
            @Value("${app.analytics.password:}") String analyticsPassword,
            @Value("${server.servlet.session.cookie.secure:false}") boolean secureCookie,
            LlmChat llmChat) {
        return args -> {
            if (DEFAULT_DB_PASSWORD.equals(sourcePassword) || DEFAULT_DB_PASSWORD.equals(analyticsPassword)) {
                log.warn("Для базы данных используется пароль по умолчанию (root). "
                        + "Задайте DB_PASSWORD и ANALYTICS_DB_PASSWORD перед выходом в эксплуатацию.");
            }
            if (!secureCookie) {
                log.info("Cookie сессии выдаётся без флага Secure. За HTTPS-прокси задайте SESSION_COOKIE_SECURE=true.");
            }
            if (llmChat.enabled()) {
                log.warn("LLM-классификация включена ({}): тексты обращений клиентов передаются внешнему сервису.",
                        llmChat.describe());
            }
        };
    }
}
