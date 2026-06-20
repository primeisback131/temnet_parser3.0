package com.temnet.temnet_parser.service;

import com.temnet.temnet_parser.dto.Bucket;
import com.temnet.temnet_parser.dto.HeatmapCell;
import com.temnet.temnet_parser.dto.MetricPoint;
import com.temnet.temnet_parser.dto.SlaPoint;
import com.temnet.temnet_parser.repository.MetricsRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;

@Service
public class MetricsService {

    private final MetricsRepository metricsRepository;

    public MetricsService(MetricsRepository metricsRepository) {
        this.metricsRepository = metricsRepository;
    }

    public List<MetricPoint> timeseries(LocalDate start, LocalDate end, String groupName, Bucket bucket) {
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
        return metricsRepository.timeseries(start, end, groupName, bucket);
    }

    public List<HeatmapCell> heatmap(LocalDate start, LocalDate end, String groupName) {
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
        return metricsRepository.heatmap(start, end, groupName);
    }

    public List<SlaPoint> sla(LocalDate start, LocalDate end, String groupName, Bucket bucket) {
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
        return metricsRepository.sla(start, end, groupName, bucket);
    }
}
