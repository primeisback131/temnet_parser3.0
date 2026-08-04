package com.temnet.temnet_parser.controller;

import com.temnet.temnet_parser.dto.UserStat;
import com.temnet.temnet_parser.security.AccessControlService;
import com.temnet.temnet_parser.security.AccessControlService.Area;
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
    private final AccessControlService accessControl;

    public UserStatsController(UserStatsService userStatsService, AccessControlService accessControl) {
        this.userStatsService = userStatsService;
        this.accessControl = accessControl;
    }

    @GetMapping("/users")
    public List<UserStat> getReport(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam String groupName) {
                // Refuses outright when the group was not granted.
        return userStatsService.report(start, end, groupName,
                accessControl.scope(groupName, Area.METRICS));
    }
}
