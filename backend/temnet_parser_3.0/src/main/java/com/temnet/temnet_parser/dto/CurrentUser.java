package com.temnet.temnet_parser.dto;

import java.util.List;

/**
 * What the signed-in user may see, as handed to the frontend: the resolved
 * group lists let the UI hide what the backend would refuse anyway.
 * {@code unrestricted} marks an administrator — every group, present and future.
 * {@code mustChangePassword} means the account still holds a temporary
 * password and the backend refuses everything but changing it.
 */
public record CurrentUser(
        String username,
        String fullName,
        String role,
        boolean mustChangePassword,
        boolean unrestricted,
        List<String> metricsGroups,
        List<String> chatGroups,
        List<String> helpAccounts
) {
}
