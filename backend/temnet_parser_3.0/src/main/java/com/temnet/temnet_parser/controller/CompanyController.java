package com.temnet.temnet_parser.controller;

import com.temnet.temnet_parser.dto.Company;
import com.temnet.temnet_parser.service.CompanyService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

import static org.springframework.format.annotation.DateTimeFormat.ISO;

@RestController
@RequestMapping("/companies")
public class CompanyController {

    private final CompanyService companyService;

    public CompanyController(CompanyService companyService) {
        this.companyService = companyService;
    }

    @GetMapping
    public List<Company> getReport(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end) {
        return companyService.report(start, end);
    }
}
