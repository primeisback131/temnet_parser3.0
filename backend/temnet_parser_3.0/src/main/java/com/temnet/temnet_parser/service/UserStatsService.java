package com.temnet.temnet_parser.service;

import com.temnet.temnet_parser.dto.UserStat;
import com.temnet.temnet_parser.repository.UserStatsRepository;
import com.temnet.temnet_parser.security.Scope;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;

@Service
public class UserStatsService {

    private final UserStatsRepository userStatsRepository;

    public UserStatsService(UserStatsRepository userStatsRepository) {
        this.userStatsRepository = userStatsRepository;
    }

    public List<UserStat> report(LocalDate start, LocalDate end, String groupName, Scope scope) {
        return userStatsRepository.findReport(start, end, groupName, scope);
    }
}
