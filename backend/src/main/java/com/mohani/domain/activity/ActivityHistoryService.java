package com.mohani.domain.activity;

import com.mohani.domain.team.TeamMemberRepository;
import com.mohani.domain.team.exception.NotATeamMemberException;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ActivityHistoryService {

    private static final int MAX_LIMIT = 50;
    private static final int DEFAULT_LIMIT = 10;

    private final ActivityLogRepository activities;
    private final TeamMemberRepository memberships;

    public ActivityHistoryService(ActivityLogRepository activities, TeamMemberRepository memberships) {
        this.activities = activities;
        this.memberships = memberships;
    }

    @Transactional(readOnly = true)
    public List<ActivityHistoryItem> recentByMember(long teamId, long targetUserId, long requesterUserId, Integer limit) {
        if (!memberships.existsByIdTeamIdAndIdUserId(teamId, requesterUserId)) {
            throw new NotATeamMemberException();
        }
        int size = clampLimit(limit);
        return activities.findByTeamIdAndUserIdOrderByOccurredAtDesc(teamId, targetUserId, PageRequest.of(0, size))
            .stream()
            .map(ActivityHistoryItem::from)
            .toList();
    }

    private int clampLimit(Integer requested) {
        if (requested == null || requested <= 0) return DEFAULT_LIMIT;
        return Math.min(requested, MAX_LIMIT);
    }

    public record ActivityHistoryItem(
        long id,
        OffsetDateTime occurredAt,
        String promptFirstLine,
        String eventKind
    ) {
        static ActivityHistoryItem from(ActivityLog log) {
            return new ActivityHistoryItem(
                log.getId(),
                log.getOccurredAt(),
                log.getPromptFirstLine(),
                log.getEventKind()
            );
        }
    }
}
