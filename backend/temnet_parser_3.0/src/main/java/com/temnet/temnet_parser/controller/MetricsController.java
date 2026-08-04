package com.temnet.temnet_parser.controller;

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
import com.temnet.temnet_parser.service.MetricsService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

import static org.springframework.format.annotation.DateTimeFormat.ISO;

@RestController
@RequestMapping("/metrics")
public class MetricsController {

    private final MetricsService metricsService;

    public MetricsController(MetricsService metricsService) {
        this.metricsService = metricsService;
    }

    @GetMapping("/timeseries")
    public List<MetricPoint> timeseries(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam(required = false) String groupName,
            @RequestParam(defaultValue = "day") String bucket) {
        return metricsService.timeseries(start, end, groupName, Bucket.from(bucket));
    }

    /** Tickets still open at the end of the period (the real backlog). */
    @GetMapping("/backlog")
    public BacklogReport backlog(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam(required = false) String groupName) {
        return metricsService.backlog(end, groupName);
    }

    /** The individual tickets behind the backlog count. */
    @GetMapping("/backlog/tickets")
    public List<OpenTicket> backlogTickets(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam(required = false) String groupName) {
        return metricsService.backlogTickets(end, groupName);
    }

    @GetMapping("/heatmap")
    public List<HeatmapCell> heatmap(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam(required = false) String groupName) {
        return metricsService.heatmap(start, end, groupName);
    }

    @GetMapping("/sla")
    public List<SlaPoint> sla(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam(required = false) String groupName,
            @RequestParam(defaultValue = "day") String bucket) {
        return metricsService.sla(start, end, groupName, Bucket.from(bucket));
    }

    @GetMapping("/resolution")
    public List<ResolutionPoint> resolution(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam(required = false) String groupName,
            @RequestParam(defaultValue = "day") String bucket) {
        return metricsService.resolution(start, end, groupName, Bucket.from(bucket));
    }

    @GetMapping("/reopens")
    public List<ReopenPoint> reopens(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam(required = false) String groupName,
            @RequestParam(defaultValue = "day") String bucket) {
        return metricsService.reopens(start, end, groupName, Bucket.from(bucket));
    }

    @GetMapping("/alerts")
    public AlertsReport alerts() {
        return metricsService.alerts();
    }

    @GetMapping("/categories")
    public List<CategoryCount> categories(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam(required = false) String groupName) {
        return metricsService.categories(start, end, groupName);
    }

    @GetMapping("/operators")
    public List<OperatorStat> operators(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam(required = false) String groupName) {
        return metricsService.operators(start, end, groupName);
    }
}
