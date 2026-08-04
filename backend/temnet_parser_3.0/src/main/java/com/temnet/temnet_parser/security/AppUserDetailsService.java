package com.temnet.temnet_parser.security;

import com.temnet.temnet_parser.repository.UserRepository;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class AppUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;

    public AppUserDetailsService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public AppPrincipal loadUserByUsername(String username) {
        return userRepository.findPrincipal(username)
                .orElseThrow(() -> new UsernameNotFoundException("Пользователь не найден"));
    }
}
