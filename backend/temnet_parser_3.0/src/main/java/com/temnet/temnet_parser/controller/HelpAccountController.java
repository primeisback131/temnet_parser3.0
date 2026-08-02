package com.temnet.temnet_parser.controller;

import com.temnet.temnet_parser.dto.HelpAccount;
import com.temnet.temnet_parser.dto.HelpAccountReport;
import com.temnet.temnet_parser.service.HelpAccountService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

import static org.springframework.format.annotation.DateTimeFormat.ISO;

@RestController
@RequestMapping("/help-accounts")
public class HelpAccountController {

    private final HelpAccountService helpAccountService;

    public HelpAccountController(HelpAccountService helpAccountService) {
        this.helpAccountService = helpAccountService;
    }

    @GetMapping
    public List<HelpAccount> getAccounts() {
        return helpAccountService.listAccounts();
    }

    @GetMapping("/report")
    public HelpAccountReport getReport(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam String account) {
        return helpAccountService.report(start, end, account);
    }
}
