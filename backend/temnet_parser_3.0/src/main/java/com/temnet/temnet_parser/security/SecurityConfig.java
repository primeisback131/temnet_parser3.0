package com.temnet.temnet_parser.security;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.web.cors.CorsConfigurationSource;

/**
 * Session-cookie authentication for the API.
 * <p>
 * Everything except the login endpoint requires a signed-in user, so a new
 * endpoint is closed by default rather than open by oversight. Unauthenticated
 * calls get a plain 401 instead of a redirect — the client is an SPA.
 * <p>
 * CSRF stays on (the session rides in a cookie): the token is published in a
 * JS-readable XSRF-TOKEN cookie and echoed back in the X-XSRF-TOKEN header.
 */
@Configuration
public class SecurityConfig {

    private static CsrfTokenRequestAttributeHandler eagerCsrfHandler() {
        CsrfTokenRequestAttributeHandler handler = new CsrfTokenRequestAttributeHandler();
        handler.setCsrfRequestAttributeName(null);
        return handler;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    /**
     * Explicit manager: defining a custom filter chain means Boot no longer
     * publishes one, and the login endpoint authenticates by hand.
     */
    @Bean
    public AuthenticationManager authenticationManager(AppUserDetailsService userDetailsService,
                                                       PasswordEncoder passwordEncoder) {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider(userDetailsService);
        provider.setPasswordEncoder(passwordEncoder);
        return new ProviderManager(provider);
    }

    @Bean
    public SecurityFilterChain filterChain(
            HttpSecurity http,
            @Qualifier("corsConfigurationSource") CorsConfigurationSource cors) throws Exception {
        return http
                .cors(c -> c.configurationSource(cors))
                .csrf(csrf -> csrf
                        .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                        // Resolve the token eagerly: with the default deferred
                        // loading the cookie is only written once something reads
                        // the token, so an SPA would never receive one.
                        .csrfTokenRequestHandler(eagerCsrfHandler())
                        // The login POST is the one request that cannot carry a
                        // token yet; it creates the session rather than acting on one.
                        .ignoringRequestMatchers("/auth/login"))
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/auth/login").permitAll()
                        .requestMatchers("/admin/**").hasRole("ADMIN")
                        // The read-only "user" role gets the company and
                        // per-user tables only. Everything richer is closed
                        // here, at the one place a forgotten UI check cannot
                        // bypass: the metrics dashboard and the operator
                        // leaderboard (/metrics/**), the correspondence
                        // (/chat/**), and the per-desk Excel report, whose
                        // endpoint exists solely to build that workbook.
                        .requestMatchers("/metrics/**", "/chat/**",
                                "/help-accounts", "/help-accounts/**")
                        .hasAnyRole("ADMIN", "MANAGER")
                        .anyRequest().authenticated())
                .exceptionHandling(e -> e.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
                .logout(l -> l.disable())
                .httpBasic(b -> b.disable())
                .formLogin(f -> f.disable())
                .build();
    }
}
