package com.mohani.domain.activity;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;

public record ActivityEventDto(
    @NotBlank String event,            // UserPromptSubmit | PreToolUse | PostToolUse | SessionStart | SessionEnd | Stop
    String sessionId,                  // agent-side session id (string)
    String cwd,                        // 정보용 (DB 저장 X) — 향후 정책에 사용
    String promptFirstLine,            // 첫 줄 마스킹 적용된 텍스트 (UserPromptSubmit)
    String toolName,                   // PreToolUse / PostToolUse
    Long totalTokens,                  // Stop / 누적 토큰
    Integer durationDeltaSec,          // 활동 시간 증분 (heartbeat 30s 등)
    String cliKind,                    // 'claude' | 'codex' (null이면 'claude'로 처리)
    @NotNull OffsetDateTime occurredAt
) {
}
