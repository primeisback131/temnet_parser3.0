package com.temnet.temnet_parser.controller;

import com.temnet.temnet_parser.dto.HelpAccount;
import com.temnet.temnet_parser.dto.HelpAccountReport;
import com.temnet.temnet_parser.security.AccessControlService;
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
    private final AccessControlService accessControl;

    public HelpAccountController(HelpAccountService helpAccountService, AccessControlService accessControl) {
        this.helpAccountService = helpAccountService;
        this.accessControl = accessControl;
    }

    /** Only the help accounts the caller was granted (all of them for admins). */
    @GetMapping
    public List<HelpAccount> getAccounts() {
        List<HelpAccount> all = helpAccountService.listAccounts();
        if (accessControl.currentUser().isAdmin()) {
            return all;
        }
        List<String> allowed = accessControl.grantedHelpAccounts();
        return all.stream()
                .filter(a -> allowed.contains(a.account()))
                .toList();
    }

    @GetMapping("/report")
    public HelpAccountReport getReport(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam String account) {
        accessControl.checkHelpAccount(account);
        return helpAccountService.report(start, end, account);
    }
}
