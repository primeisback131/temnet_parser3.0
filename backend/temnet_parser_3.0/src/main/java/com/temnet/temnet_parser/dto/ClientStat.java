package com.temnet.temnet_parser.dto;

/** A client ranked by tickets opened in the period; {@code newClient} = no earlier ticket. */
public record ClientStat(
        String client,
        String groupNames,
        Long tickets,
        Long messages,
        Long reopens,
        Boolean newClient
) {
}
