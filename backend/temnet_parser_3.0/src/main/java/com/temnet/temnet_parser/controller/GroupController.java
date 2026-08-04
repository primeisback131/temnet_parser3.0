package com.temnet.temnet_parser.controller;

import com.temnet.temnet_parser.dto.Group;
import com.temnet.temnet_parser.security.AccessControlService;
import com.temnet.temnet_parser.security.AccessControlService.Area;
import com.temnet.temnet_parser.service.GroupService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/groups")
public class GroupController {

    private final GroupService groupService;
    private final AccessControlService accessControl;

    public GroupController(GroupService groupService, AccessControlService accessControl) {
        this.groupService = groupService;
        this.accessControl = accessControl;
    }

    /**
     * Groups for the metric pickers. The chat screen asks for its own list —
     * chat access is granted separately.
     */
    @GetMapping
    public List<Group> getGroups(@RequestParam(defaultValue = "metrics") String area) {
        Area requested = "chats".equalsIgnoreCase(area) ? Area.CHATS : Area.METRICS;
        return groupService.listGroups(accessControl.visibleGroups(requested),
                accessControl.currentUser().isAdmin());
    }
}
