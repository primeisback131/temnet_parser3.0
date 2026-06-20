package com.temnet.temnet_parser.service;

import com.temnet.temnet_parser.dto.Group;
import com.temnet.temnet_parser.repository.GroupRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class GroupService {

    private final GroupRepository groupRepository;

    public GroupService(GroupRepository groupRepository) {
        this.groupRepository = groupRepository;
    }

    public List<Group> listGroups() {
        return groupRepository.findAll();
    }
}
