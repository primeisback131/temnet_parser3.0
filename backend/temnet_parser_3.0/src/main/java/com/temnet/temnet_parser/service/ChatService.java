package com.temnet.temnet_parser.service;

import com.temnet.temnet_parser.dto.ChatMessage;
import com.temnet.temnet_parser.repository.ChatRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class ChatService {

    private final ChatRepository chatRepository;

    public ChatService(ChatRepository chatRepository) {
        this.chatRepository = chatRepository;
    }

    public List<ChatMessage> history(LocalDate start, LocalDate end, String groupName) {
        return chatRepository.findHistory(start, end, groupName);
    }

    /** Distinct senders in the group's history, excluding the support ("help") side. */
    public Set<String> participants(LocalDate start, LocalDate end, String groupName) {
        return history(start, end, groupName).stream()
                .map(ChatMessage::sender)
                .filter(sender -> !sender.contains("help"))
                .collect(Collectors.toUnmodifiableSet());
    }
}
