package com.temnet.temnet_parser.controller;

import com.temnet.temnet_parser.dto.Bucket;
import com.temnet.temnet_parser.dto.CategoryCount;
import com.temnet.temnet_parser.dto.HeatmapCell;
import com.temnet.temnet_parser.dto.MetricPoint;
import com.temnet.temnet_parser.dto.OperatorStat;
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
