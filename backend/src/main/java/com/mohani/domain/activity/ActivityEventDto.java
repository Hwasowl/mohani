package com.mohani.domain.activity;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;

public record ActivityEventDto(
    @NotBlank String event,            // UserPromptSubmit | PreToolUse | PostToolUse | SessionStart | SessionEnd | Stop
    String sessionId,                  // agent-side session id (string)
    String cwd,                        // 정보용 (DB 저장 X) — 향후 정책에 사용
    String promptFirstLine,            // 첫 줄 마스킹 (UserPromptSubmit). questionHidden=true면 null
    String promptFull,                 // 사용자 프롬프트 전체 본문 — 마스킹 적용 후. questionHidden=true면 null
    String assistantPreview,           // AI 답변 요약 (Stop) — 3줄/500자. answerHidden=true면 null
    String assistantFull,              // AI 답변 전체 (Stop). answerHidden=true면 null
    Integer toolUseCount,              // Stop — 같은 turn에서 사용된 tool 호출 수
    String toolName,                   // PreToolUse / PostToolUse (현재 사용 안 함)
    Long totalTokens,                  // Stop — 응답 토큰 수
    Integer durationDeltaSec,          // 활동 시간 증분
    String cliKind,                    // 'claude' | 'codex' (null이면 'claude')
    Boolean questionHidden,            // 사용자가 켠 "질문 숨김" 토글 (null=false)
    Boolean answerHidden,              // 사용자가 켠 "답변 숨김" 토글 (null=false)
    @NotNull OffsetDateTime occurredAt
) {
}
