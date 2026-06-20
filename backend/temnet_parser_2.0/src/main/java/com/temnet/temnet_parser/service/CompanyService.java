package com.temnet.temnet_parser.service;

import com.temnet.temnet_parser.dto.Company;
import com.temnet.temnet_parser.repository.CompanyRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;

@Service
public class CompanyService {

    private final CompanyRepository companyRepository;

    public CompanyService(CompanyRepository companyRepository) {
        this.companyRepository = companyRepository;
    }

    public List<Company> report(LocalDate start, LocalDate end) {
        return companyRepository.findReport(start, end);
    }
}
