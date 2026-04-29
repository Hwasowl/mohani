package com.mohani.domain.chat;

import java.time.OffsetDateTime;

// /topic/team/{code}/chat 로 브로드캐스트되는 메시지. 영구저장 없음 — 휘발.
public record ChatMessage(
    long userId,
    String displayName,
    String avatarUrl,
    String text,
    String imageUrl,
    OffsetDateTime sentAt
) {
}
