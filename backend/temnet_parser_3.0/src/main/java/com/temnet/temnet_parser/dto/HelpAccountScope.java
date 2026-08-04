package com.temnet.temnet_parser.dto;

import java.util.List;

/**
 * A help account together with the groups a grant on it expands to, so the
 * administrator can see what they are actually handing out.
 */
public record HelpAccountScope(String account, List<String> groups) {
}
