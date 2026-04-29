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
}
