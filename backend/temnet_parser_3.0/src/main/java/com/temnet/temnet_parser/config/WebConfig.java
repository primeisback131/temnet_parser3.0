package com.temnet.temnet_parser.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

/**
 * Single source of CORS configuration for the whole API, consumed by the
 * security filter chain.
 * <p>
 * The intended deployment serves the SPA and the API from one origin (the
 * Vite dev server proxies {@code /api}, a reverse proxy does the same in
 * production), so by default no cross-origin access is allowed at all. Set
 * {@code app.cors.allowed-origin} only when the frontend really lives on
 * another origin; credentials are then allowed because authentication rides
 * on the session cookie, which in turn forbids a wildcard.
 */
@Configuration
public class WebConfig {

    private final String allowedOrigin;

    public WebConfig(@Value("${app.cors.allowed-origin:}") String allowedOrigin) {
        this.allowedOrigin = allowedOrigin;
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        List<String> origins = Arrays.stream(allowedOrigin.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
        if (origins.isEmpty()) {
            return source; // same-origin only: cross-origin preflights are refused
        }
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOrigins(origins);
        cors.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
        cors.setAllowedHeaders(List.of("Content-Type", "X-XSRF-TOKEN"));
        cors.setAllowCredentials(true);
        source.registerCorsConfiguration("/**", cors);
        return source;
    }
}
