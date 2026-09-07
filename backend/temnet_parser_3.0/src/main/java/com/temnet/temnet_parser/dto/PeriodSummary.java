package com.temnet.temnet_parser.dto;

/**
 * Quality summary of the tickets opened in a period - counts only, the
 * screen turns them into shares. Durations are WORKING seconds.
 * <p>
 * Outcomes: {@code closed + rejected + expired + stillOpen == opened}.
 * {@code unanswered} are ended tickets with no operator message at all.
 * {@code answered*} count first responses within the cap / 15 min / 1 h;
 * {@code resolved*} count closures within the cap / one hour / one working day.
 * {@code replies}/{@code replySeconds} are operator replies AFTER the first
 * one; {@code handoffs} are tickets where more than one desk wrote.
 * {@code offHours} are incoming messages outside Mon-Fri 08:00-18:00.
 */
public record PeriodSummary(
        Long opened,
        Long closed,
        Long rejected,
        Long expired,
        Long stillOpen,
        Long unanswered,
        Long answered,
        Long answeredFast,
        Long answeredHour,
        Long resolved,
        Long resolvedHour,
        Long resolvedDay,
        Long inProgress,
        Double avgPickupSeconds,
        Long thanked,
        Long replies,
        Long replySeconds,
        Double avgMessages,
        Double p50Messages,
        Double p90Messages,
        Long handoffs,
        Long clients,
        Long newClients,
        Long incoming,
        Long offHours
) {
}
