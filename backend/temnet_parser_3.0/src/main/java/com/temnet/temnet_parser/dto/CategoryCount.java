package com.temnet.temnet_parser.dto;

/**
 * Client requests of one problem category over a period, and what they cost:
 * median first response and resolution (working seconds, outliers capped as
 * on the charts; null when nothing qualified), messages per ticket, repeat
 * requests and tickets that ended without any reply.
 */
public record CategoryCount(
        String category,
        Long requests,
        Double p50FrtSeconds,
        Double p50ResolutionSeconds,
        Double avgMessages,
        Long reopens,
        Long unanswered
) {
}
