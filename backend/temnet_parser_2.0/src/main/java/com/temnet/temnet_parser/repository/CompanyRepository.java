package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.Company;
import com.temnet.temnet_parser.support.SqlLoader;
import org.springframework.jdbc.core.DataClassRowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public class CompanyRepository {

    private static final String SQL = SqlLoader.load("sql/companies.sql");

    private final JdbcClient jdbcClient;

    public CompanyRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public List<Company> findReport(LocalDate start, LocalDate end) {
        return jdbcClient.sql(SQL)
                .param("start", start)
                .param("end", end)
                .query(new DataClassRowMapper<>(Company.class))
                .list();
    }
}
