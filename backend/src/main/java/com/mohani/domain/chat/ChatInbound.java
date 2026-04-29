package com.mohani.domain.chat;

// 클라이언트가 STOMP /app/team/{code}/chat 으로 보내는 메시지.
// text 또는 imageUrl 중 하나는 반드시 있어야 한다 (둘 다 가능).
public record ChatInbound(String text, String imageUrl) {
}
