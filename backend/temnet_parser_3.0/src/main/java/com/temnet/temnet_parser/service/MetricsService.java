package com.temnet.temnet_parser.service;

import com.temnet.temnet_parser.dto.Alert;
import com.temnet.temnet_parser.dto.AlertsReport;
import com.temnet.temnet_parser.dto.BacklogReport;
import com.temnet.temnet_parser.dto.Bucket;
import com.temnet.temnet_parser.dto.CategoryCount;
import com.temnet.temnet_parser.dto.HeatmapCell;
import com.temnet.temnet_parser.dto.MetricPoint;
import com.temnet.temnet_parser.dto.OpenTicket;
import com.temnet.temnet_parser.dto.OperatorStat;
import com.temnet.temnet_parser.dto.ReopenPoint;
import com.temnet.temnet_parser.dto.ResolutionPoint;
import com.temnet.temnet_parser.dto.SlaPoint;
import com.temnet.temnet_parser.repository.MetricsRepository;
import com.temnet.temnet_parser.security.Scope;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;

/**
 * Results are cached per parameter combination (Caffeine, short TTL — see
 * {@code spring.cache.caffeine.spec}): the queries are heavy archive scans
 * and historical data never changes.
 */
@Service
public class MetricsService {

    private final MetricsRepository metricsRepository;

    public MetricsService(MetricsRepository metricsRepository) {
        this.metricsRepository = metricsRepository;
    }

    @Cacheable("timeseries")
    public List<MetricPoint> timeseries(LocalDate start, LocalDate end, Scope scope, Bucket bucket) {
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
        return metricsRepository.timeseries(start, end, scope, bucket);
    }

    /** Tickets still open at the end of the period (the real backlog). */
    @Cacheable("backlog")
    public BacklogReport backlog(LocalDate end, Scope scope) {
        return metricsRepository.backlog(end, scope);
    }

    /** The individual tickets behind {@link #backlog}, for manual checking. */
    @Cacheable("backlogTickets")
    public List<OpenTicket> backlogTickets(LocalDate end, Scope scope) {
        return metricsRepository.backlogTickets(end, scope);
    }

    @Cacheable("heatmap")
    public List<HeatmapCell> heatmap(LocalDate start, LocalDate end, Scope scope) {
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
        return metricsRepository.heatmap(start, end, scope);
    }

    @Cacheable("sla")
    public List<SlaPoint> sla(LocalDate start, LocalDate end, Scope scope, Bucket bucket) {
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
        return metricsRepository.sla(start, end, scope, bucket);
    }

    @Cacheable("resolution")
    public List<ResolutionPoint> resolution(LocalDate start, LocalDate end, Scope scope, Bucket bucket) {
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
        return metricsRepository.resolution(start, end, scope, bucket);
    }

    @Cacheable("reopens")
    public List<ReopenPoint> reopens(LocalDate start, LocalDate end, Scope scope, Bucket bucket) {
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
        return metricsRepository.reopens(start, end, scope, bucket);
    }

    /**
     * Anomalies across groups. The underlying query cannot be scoped cheaply,
     * so the report is filtered afterwards — a manager never sees a group they
     * were not granted.
     */
    @Cacheable("alerts")
    public AlertsReport alerts(Scope scope) {
        AlertsReport report = metricsRepository.alerts();
        if (scope.unrestricted()) {
            return report;
        }
        List<Alert> visible = report.alerts().stream()
                .filter(a -> scope.groups().contains(a.groupName()))
                .toList();
        return new AlertsReport(report.asOf(), report.weekStart(), visible);
    }

    @Cacheable("categories")
    public List<CategoryCount> categories(LocalDate start, LocalDate end, Scope scope) {
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
        return metricsRepository.categories(start, end, scope);
    }

    @Cacheable("operators")
    public List<OperatorStat> operators(LocalDate start, LocalDate end, Scope scope) {
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
        return metricsRepository.operators(start, end, scope);
    }
}
