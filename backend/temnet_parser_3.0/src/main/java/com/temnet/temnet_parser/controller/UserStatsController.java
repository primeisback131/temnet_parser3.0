package com.temnet.temnet_parser.controller;

import com.temnet.temnet_parser.dto.UserStat;
import com.temnet.temnet_parser.service.UserStatsService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

import static org.springframework.format.annotation.DateTimeFormat.ISO;

@RestController
public class UserStatsController {

    private final UserStatsService userStatsService;

    public UserStatsController(UserStatsService userStatsService) {
        this.userStatsService = userStatsService;
    }

    @GetMapping("/users")
    public List<UserStat> getReport(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam String groupName) {
        return userStatsService.report(start, end, groupName);
    }
}
