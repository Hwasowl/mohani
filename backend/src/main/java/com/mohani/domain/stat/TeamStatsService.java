package com.mohani.domain.stat;

import com.mohani.domain.activity.ActivityLogRepository;
import com.mohani.domain.activity.ActivityLogRepository.UserLastSeen;
import com.mohani.domain.team.TeamMember;
import com.mohani.domain.team.TeamMemberRepository;
import com.mohani.domain.team.exception.NotATeamMemberException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TeamStatsService {

    private final TeamMemberRepository memberships;
    private final StatService stats;
    private final ActivityLogRepository activities;

    public TeamStatsService(TeamMemberRepository memberships,
                            StatService stats,
                            ActivityLogRepository activities) {
        this.memberships = memberships;
        this.stats = stats;
        this.activities = activities;
    }

    @Transactional(readOnly = true)
    public List<TodayStat> todayStats(long teamId, long requesterUserId) {
        if (!memberships.existsByIdTeamIdAndIdUserId(teamId, requesterUserId)) {
            throw new NotATeamMemberException();
        }
        List<TeamMember> rows = memberships.findAllByIdTeamId(teamId);
        List<Long> userIds = rows.stream().map(TeamMember::userId).toList();
        if (userIds.isEmpty()) return List.of();

        // lastSeen 일괄 조회 — 활동이 한 번도 없는 멤버는 응답에 없음
        Map<Long, OffsetDateTime> lastSeenByUser = new HashMap<>();
        for (UserLastSeen row : activities.findLastSeenForUsers(teamId, userIds)) {
            lastSeenByUser.put(row.getUserId(), row.getLastSeen());
        }

        LocalDate today = LocalDate.now();
        return userIds.stream()
            .map(userId -> new TodayStat(
                userId,
                stats.getTodayTokens(userId, today),
                stats.getTodayDurationSec(userId, today),
                lastSeenByUser.get(userId)
            ))
            .toList();
    }

    public record TodayStat(
        long userId,
        long todayTokens,
        long todayDurationSec,
        OffsetDateTime lastSeen
    ) {}
}
