package com.mohani.domain.activity;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ActivityLogRepository extends JpaRepository<ActivityLog, Long> {

    List<ActivityLog> findByTeamIdAndUserIdOrderByOccurredAtDesc(Long teamId, Long userId, Pageable pageable);

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
        String getPromptFirstLine();
        String getEventKind();
        String getCliKind();
    }

    // 팀 전체 시간순 피드 — UserPromptSubmit + 비어있지 않은 prompt만 (노이즈 제거)
    @Query("""
        SELECT a.id AS id,
               a.occurredAt AS occurredAt,
               a.userId AS userId,
               u.displayName AS displayName,
               a.promptFirstLine AS promptFirstLine,
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
