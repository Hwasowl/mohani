package com.mohani.domain.activity;

import com.mohani.domain.activity.ActivityLogRepository.FeedRow;
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
    private static final int FEED_DEFAULT_LIMIT = 30;
    private static final int FEED_MAX_LIMIT = 100;

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

    @Transactional(readOnly = true)
    public List<FeedItem> teamFeed(long teamId, long requesterUserId, Integer limit) {
        if (!memberships.existsByIdTeamIdAndIdUserId(teamId, requesterUserId)) {
            throw new NotATeamMemberException();
        }
        int size = clampFeedLimit(limit);
        return activities.findTeamFeed(teamId, PageRequest.of(0, size))
            .stream()
            .map(FeedItem::from)
            .toList();
    }

    private int clampLimit(Integer requested) {
        if (requested == null || requested <= 0) return DEFAULT_LIMIT;
        return Math.min(requested, MAX_LIMIT);
    }

    private int clampFeedLimit(Integer requested) {
        if (requested == null || requested <= 0) return FEED_DEFAULT_LIMIT;
        return Math.min(requested, FEED_MAX_LIMIT);
    }

    public record ActivityHistoryItem(
        long id,
        OffsetDateTime occurredAt,
        String promptFirstLine,
        String eventKind,
        String cliKind
    ) {
        static ActivityHistoryItem from(ActivityLog log) {
            return new ActivityHistoryItem(
                log.getId(),
                log.getOccurredAt(),
                log.getPromptFirstLine(),
                log.getEventKind(),
                log.getCliKind()
            );
        }
    }

    public record FeedItem(
        long id,
        OffsetDateTime occurredAt,
        long userId,
        String displayName,
        String avatarUrl,
        String promptFirstLine,
        String eventKind,
        String cliKind
    ) {
        static FeedItem from(FeedRow row) {
            return new FeedItem(
                row.getId(),
                row.getOccurredAt(),
                row.getUserId(),
                row.getDisplayName(),
                row.getAvatarUrl(),
                row.getPromptFirstLine(),
                row.getEventKind(),
                row.getCliKind()
            );
        }
    }
}
