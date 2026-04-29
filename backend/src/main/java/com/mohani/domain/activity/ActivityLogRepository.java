package com.mohani.domain.activity;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ActivityLogRepository extends JpaRepository<ActivityLog, Long> {

    // 멤버 활동 드로어 — 질문이나 답변 둘 중 하나라도 있는 의미 있는 row만 반환.
    @Query("""
        SELECT a FROM ActivityLog a
        WHERE a.teamId = :teamId AND a.userId = :userId
          AND ( (a.promptFirstLine IS NOT NULL AND a.promptFirstLine <> '')
             OR (a.assistantPreview IS NOT NULL AND a.assistantPreview <> '') )
        ORDER BY a.occurredAt DESC
    """)
    List<ActivityLog> findByTeamIdAndUserIdOrderByOccurredAtDesc(@Param("teamId") Long teamId,
                                                                 @Param("userId") Long userId,
                                                                 Pageable pageable);

    // turn 매칭용 — 같은 (user, cli, team) 의 가장 최근 미응답(UserPromptSubmit) row 찾기.
    // Stop이 도착하면 이 row에 assistant 정보를 합친다(같은 row update).
    @Query("""
        SELECT a FROM ActivityLog a
        WHERE a.userId = :userId
          AND a.teamId = :teamId
          AND a.cliKind = :cliKind
          AND a.eventKind = 'UserPromptSubmit'
          AND a.assistantPreview IS NULL
          AND a.occurredAt >= :since
        ORDER BY a.occurredAt DESC
    """)
    List<ActivityLog> findUnansweredTurns(@Param("userId") Long userId,
                                          @Param("teamId") Long teamId,
                                          @Param("cliKind") String cliKind,
                                          @Param("since") OffsetDateTime since,
                                          Pageable pageable);

    interface UserLastSeen {
        Long getUserId();
        OffsetDateTime getLastSeen();
    }

    @Query("""
        SELECT a.userId AS userId, MAX(a.occurredAt) AS lastSeen
        FROM ActivityLog a
        WHERE a.teamId = :teamId AND a.userId IN :userIds
        GROUP BY a.userId
    """)
    List<UserLastSeen> findLastSeenForUsers(@Param("teamId") Long teamId,
                                            @Param("userIds") List<Long> userIds);

    interface FeedRow {
        Long getId();
        OffsetDateTime getOccurredAt();
        Long getUserId();
        String getDisplayName();
        String getAvatarUrl();
        String getPromptFirstLine();
        String getAssistantPreview();
        Integer getToolUseCount();
        Integer getResponseTokens();
        String getEventKind();
        String getCliKind();
    }

    // 팀 전체 시간순 피드 — UserPromptSubmit + 비어있지 않은 prompt만 (노이즈 제거)
    @Query("""
        SELECT a.id AS id,
               a.occurredAt AS occurredAt,
               a.userId AS userId,
               u.displayName AS displayName,
               u.avatarUrl AS avatarUrl,
               a.promptFirstLine AS promptFirstLine,
               a.assistantPreview AS assistantPreview,
               a.toolUseCount AS toolUseCount,
               a.responseTokens AS responseTokens,
               a.eventKind AS eventKind,
               a.cliKind AS cliKind
        FROM ActivityLog a
        JOIN User u ON u.id = a.userId
        WHERE a.teamId = :teamId
          AND a.eventKind = 'UserPromptSubmit'
          AND a.promptFirstLine IS NOT NULL
          AND a.promptFirstLine <> ''
        ORDER BY a.occurredAt DESC
    """)
    List<FeedRow> findTeamFeed(@Param("teamId") Long teamId, Pageable pageable);
}
