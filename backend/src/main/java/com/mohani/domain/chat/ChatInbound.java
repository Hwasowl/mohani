package com.mohani.domain.chat;

// 클라이언트가 STOMP /app/team/{code}/chat 으로 보내는 메시지.
public record ChatInbound(String text) {
}
