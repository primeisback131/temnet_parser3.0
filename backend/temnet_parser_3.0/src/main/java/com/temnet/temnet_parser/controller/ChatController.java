package com.temnet.temnet_parser.controller;

import com.temnet.temnet_parser.dto.ChatMessage;
import com.temnet.temnet_parser.security.AccessControlService;
import com.temnet.temnet_parser.security.AccessControlService.Area;
import com.temnet.temnet_parser.service.ChatService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.springframework.format.annotation.DateTimeFormat.ISO;

@RestController
@RequestMapping("/chat")
public class ChatController {

    private final ChatService chatService;
    private final AccessControlService accessControl;

    public ChatController(ChatService chatService, AccessControlService accessControl) {
        this.chatService = chatService;
        this.accessControl = accessControl;
    }

    /**
     * Reading correspondence needs the CHATS grant — being allowed to see a
     * group's numbers does not imply being allowed to read its messages.
     */
    @GetMapping
    public List<ChatMessage> getHistory(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam String groupName) {
        return chatService.history(start, end, accessControl.scope(groupName, Area.CHATS));
    }

    @GetMapping("/chatlist")
    public Map<String, Set<String>> getParticipants(
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end,
            @RequestParam String groupName) {
        return Map.of("results",
                chatService.participants(start, end, accessControl.scope(groupName, Area.CHATS)));
    }
}
