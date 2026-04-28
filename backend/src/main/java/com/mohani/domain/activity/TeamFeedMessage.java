package com.mohani.domain.activity;

import java.time.OffsetDateTime;

// /topic/team/{teamCode} 로 발행되는 메시지 형태.
public record TeamFeedMessage(
    String event,
    long userId,
    String displayName,
    String promptFirstLine,
    String toolName,
    long todayTokens,
    long todayDurationSec,
    OffsetDateTime occurredAt
) {
}
