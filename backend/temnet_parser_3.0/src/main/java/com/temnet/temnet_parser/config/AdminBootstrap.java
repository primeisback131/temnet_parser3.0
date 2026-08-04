package com.temnet.temnet_parser.config;

import com.temnet.temnet_parser.service.UserService;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * A fresh install has no accounts and would be unreachable, so the first
 * administrator is created on startup (see {@link UserService#ensureAdminExists}).
 */
@Configuration
public class AdminBootstrap {

    @Bean
    public ApplicationRunner createInitialAdmin(UserService userService) {
        return args -> userService.ensureAdminExists();
    }
}
