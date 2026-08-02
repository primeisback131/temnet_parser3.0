package com.temnet.temnet_parser.dto;

import java.util.List;

/**
 * Full report for one help account over a period: every implemented metric,
 * broken down by the user groups (organizations) the account serves.
 */
public record HelpAccountReport(
        List<GroupUserStat> users,
        List<GroupSlaStat> sla,
        List<GroupResolutionStat> resolution,
        List<GroupReopenStat> reopens,
        List<GroupDailyPoint> timeseries,
        List<GroupCategoryCount> categories
) {
}
