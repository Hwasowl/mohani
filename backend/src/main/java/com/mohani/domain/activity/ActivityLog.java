package com.mohani.domain.activity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "activity_log")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ActivityLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id")
    private Long sessionId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "team_id")
    private Long teamId;

    @Column(name = "occurred_at", nullable = false)
    private OffsetDateTime occurredAt;

    @Column(name = "prompt_first_line", length = 200)
    private String promptFirstLine;

    // 사용자 프롬프트 전체 본문 (마스킹 적용 후). null 가능 — Stop만 들어온 경우.
    @Column(name = "prompt_full", columnDefinition = "TEXT")
    private String promptFull;

    // AI 답변 요약 (3줄/500자 컷). null이면 아직 응답 미수신.
    @Column(name = "assistant_preview", length = 500)
    private String assistantPreview;

    // AI 답변 전체 본문 (마스킹 적용 후).
    @Column(name = "assistant_full", columnDefinition = "TEXT")
    private String assistantFull;

    @Column(name = "tool_use_count", nullable = false)
    private int toolUseCount;

    @Column(name = "response_tokens", nullable = false)
    private int responseTokens;

    @Column(name = "event_kind", nullable = false, length = 24)
    private String eventKind;

    @Column(name = "cli_kind", nullable = false, length = 16)
    private String cliKind;

    @Builder
    private ActivityLog(Long sessionId, Long userId, Long teamId, OffsetDateTime occurredAt,
                        String promptFirstLine, String promptFull,
                        String assistantPreview, String assistantFull,
                        int toolUseCount, int responseTokens,
                        String eventKind, String cliKind) {
        this.sessionId = sessionId;
        this.userId = userId;
        this.teamId = teamId;
        this.occurredAt = occurredAt;
        this.promptFirstLine = promptFirstLine;
        this.promptFull = promptFull;
        this.assistantPreview = assistantPreview;
        this.assistantFull = assistantFull;
        this.toolUseCount = toolUseCount;
        this.responseTokens = responseTokens;
        this.eventKind = eventKind;
        this.cliKind = cliKind == null ? "claude" : cliKind;
    }

    // turn 응답 도착 시 in-place update — INSERT 두 번 안 만들고 같은 row에 합친다.
    public void attachAssistantTurn(String preview, String full, int toolUseCount, int responseTokens) {
        this.assistantPreview = preview;
        this.assistantFull = full;
        this.toolUseCount = toolUseCount;
        this.responseTokens = responseTokens;
    }
}
