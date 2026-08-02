package com.temnet.temnet_parser.service;

import com.temnet.temnet_parser.dto.HelpAccount;
import com.temnet.temnet_parser.dto.HelpAccountReport;
import com.temnet.temnet_parser.repository.HelpAccountRepository;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;

@Service
public class HelpAccountService {

    private final HelpAccountRepository helpAccountRepository;

    public HelpAccountService(HelpAccountRepository helpAccountRepository) {
        this.helpAccountRepository = helpAccountRepository;
    }

    public List<HelpAccount> listAccounts() {
        return helpAccountRepository.findAll();
    }

    @Cacheable("helpAccountReport")
    public HelpAccountReport report(LocalDate start, LocalDate end, String account) {
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
        return new HelpAccountReport(
                helpAccountRepository.findUsers(start, end, account),
                helpAccountRepository.findSla(start, end, account),
                helpAccountRepository.findResolution(start, end, account),
                helpAccountRepository.findReopens(start, end, account),
                helpAccountRepository.findTimeseries(start, end, account),
                helpAccountRepository.findCategories(start, end, account));
    }
}
