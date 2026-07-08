package com.temnet.temnet_parser.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Single source of CORS configuration for the whole API.
 * Replaces the per-controller @CrossOrigin annotations.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final String allowedOrigin;

    public WebConfig(@Value("${app.cors.allowed-origin}") String allowedOrigin) {
        this.allowedOrigin = allowedOrigin;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOrigins(allowedOrigin)
                .allowedMethods("GET");
    }
}
