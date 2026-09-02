package com.temnet.temnet_parser.service;

import com.temnet.temnet_parser.dto.ChatMessage;
import com.temnet.temnet_parser.repository.ChatRepository;
import com.temnet.temnet_parser.security.Scope;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;

@Service
public class ChatService {

    private final ChatRepository chatRepository;

    public ChatService(ChatRepository chatRepository) {
        this.chatRepository = chatRepository;
    }

    /** The scope's correspondence in the period, or one client's conversation when {@code client} is given. */
    public List<ChatMessage> history(LocalDate start, LocalDate end, Scope scope, String client) {
        return chatRepository.findHistory(start, end, scope, client);
    }

    /** Clients who talked to support in the period — the conversation list. */
    public List<String> participants(LocalDate start, LocalDate end, Scope scope) {
        return chatRepository.findParticipants(start, end, scope);
    }
}
