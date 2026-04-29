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

    @Column(name = "event_kind", nullable = false, length = 24)
    private String eventKind;

    @Column(name = "cli_kind", nullable = false, length = 16)
    private String cliKind;

    @Builder
    private ActivityLog(Long sessionId, Long userId, Long teamId, OffsetDateTime occurredAt,
                        String promptFirstLine, String eventKind, String cliKind) {
        this.sessionId = sessionId;
        this.userId = userId;
        this.teamId = teamId;
        this.occurredAt = occurredAt;
        this.promptFirstLine = promptFirstLine;
        this.eventKind = eventKind;
        this.cliKind = cliKind == null ? "claude" : cliKind;
    }
}
