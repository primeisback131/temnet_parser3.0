package com.temnet.temnet_parser.security;

import jakarta.servlet.http.HttpServletRequest;

/**
 * The address a request really came from.
 * <p>
 * The SPA reaches the API through a local proxy (the Vite server on the
 * same machine), which makes every caller look like 127.0.0.1. The proxy
 * adds {@code X-Forwarded-For}; it is trusted only when the immediate peer
 * is loopback, so nothing on the network can forge an address. Behind a
 * real reverse proxy on another host use {@code FORWARD_HEADERS_STRATEGY}.
 */
public final class ClientIp {

    private ClientIp() {
    }

    public static String of(HttpServletRequest request) {
        String remote = request.getRemoteAddr();
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank() && isLoopback(remote)) {
            return forwarded.split(",")[0].trim();
        }
        return remote;
    }

    private static boolean isLoopback(String address) {
        return "127.0.0.1".equals(address) || "::1".equals(address) || "0:0:0:0:0:0:0:1".equals(address);
    }
}
