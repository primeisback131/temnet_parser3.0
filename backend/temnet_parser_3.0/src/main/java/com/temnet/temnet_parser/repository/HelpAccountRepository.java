package com.temnet.temnet_parser.repository;

import com.temnet.temnet_parser.dto.GroupCategoryCount;
import com.temnet.temnet_parser.dto.GroupDailyPoint;
import com.temnet.temnet_parser.dto.GroupReopenStat;
import com.temnet.temnet_parser.dto.GroupResolutionStat;
import com.temnet.temnet_parser.dto.GroupSlaStat;
import com.temnet.temnet_parser.dto.GroupUserStat;
import com.temnet.temnet_parser.dto.HelpAccount;
import com.temnet.temnet_parser.support.SqlLoader;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.DataClassRowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public class HelpAccountRepository {

    private static final String ACCOUNTS_SQL = SqlLoader.load("sql/help_accounts.sql");
    private static final String USERS_SQL = SqlLoader.load("sql/help_account_users.sql");
    private static final String SLA_SQL = SqlLoader.load("sql/help_account_sla.sql");
    private static final String RESOLUTION_SQL = SqlLoader.load("sql/help_account_resolution.sql");
    private static final String REOPENS_SQL = SqlLoader.load("sql/help_account_reopens.sql");
    private static final String TIMESERIES_SQL = SqlLoader.load("sql/help_account_timeseries.sql");
    private static final String CATEGORIES_SQL = SqlLoader.load("sql/help_account_categories.sql");

    // Outlier guards in WORKING seconds, same values as MetricsRepository:
    // first responses over one working day and resolutions over five working
    // days are treated as mis-pairings and dropped.
    private static final int MAX_FRT_SECONDS = 10 * 3600;
    private static final int MAX_RESOLUTION_SECONDS = 5 * 10 * 3600;

    private final JdbcClient jdbcClient;

    public HelpAccountRepository(@Qualifier("analyticsJdbcClient") JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public List<HelpAccount> findAll() {
        return jdbcClient.sql(ACCOUNTS_SQL)
                .query(new DataClassRowMapper<>(HelpAccount.class))
                .list();
    }

    public List<GroupUserStat> findUsers(LocalDate start, LocalDate end, String account) {
        return scoped(USERS_SQL, start, end, account)
                .query(new DataClassRowMapper<>(GroupUserStat.class))
                .list();
    }

    public List<GroupSlaStat> findSla(LocalDate start, LocalDate end, String account) {
        return scoped(SLA_SQL, start, end, account)
                .param("maxFrtSeconds", MAX_FRT_SECONDS)
                .query(new DataClassRowMapper<>(GroupSlaStat.class))
                .list();
    }

    public List<GroupResolutionStat> findResolution(LocalDate start, LocalDate end, String account) {
        return scoped(RESOLUTION_SQL, start, end, account)
                .param("maxResolutionSeconds", MAX_RESOLUTION_SECONDS)
                .query(new DataClassRowMapper<>(GroupResolutionStat.class))
                .list();
    }

    public List<GroupReopenStat> findReopens(LocalDate start, LocalDate end, String account) {
        return scoped(REOPENS_SQL, start, end, account)
                .query(new DataClassRowMapper<>(GroupReopenStat.class))
                .list();
    }

    public List<GroupDailyPoint> findTimeseries(LocalDate start, LocalDate end, String account) {
        return scoped(TIMESERIES_SQL, start, end, account)
                .query(new DataClassRowMapper<>(GroupDailyPoint.class))
                .list();
    }

    public List<GroupCategoryCount> findCategories(LocalDate start, LocalDate end, String account) {
        return scoped(CATEGORIES_SQL, start, end, account)
                .query(new DataClassRowMapper<>(GroupCategoryCount.class))
                .list();
    }

    /** Binds the period and account shared by every report query. */
    private JdbcClient.StatementSpec scoped(String sql, LocalDate start, LocalDate end, String account) {
        // The end date is inclusive: half-open [start, end+1day) interval.
        return jdbcClient.sql(sql)
                .param("start", start)
                .param("endExclusive", end.plusDays(1))
                .param("account", account);
    }
}
