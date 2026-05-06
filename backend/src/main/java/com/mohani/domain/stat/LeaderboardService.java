package com.mohani.domain.stat;

import com.mohani.domain.auth.User;
import com.mohani.domain.auth.UserRepository;
import com.mohani.domain.team.TeamMember;
import com.mohani.domain.team.TeamMemberRepository;
import com.mohani.domain.team.exception.NotATeamMemberException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// 팀 토큰 랭킹. 친구 ~5명 규모라 ZSET 없이 멤버 단위 GET 후 메모리 정렬.
// Phase 1: 오늘(LocalDate) 기준 totalTokens 누적값. window 7d/30d는 Phase 2에서 day key MGET 합산.
@Service
public class LeaderboardService {

    private final TeamMemberRepository memberships;
    private final UserRepository users;
    private final StatService stats;

    public LeaderboardService(TeamMemberRepository memberships,
                              UserRepository users,
                              StatService stats) {
        this.memberships = memberships;
        this.users = users;
        this.stats = stats;
    }

    @Transactional(readOnly = true)
    public List<LeaderboardEntry> tokenLeaderboard(long teamId, long requesterUserId, LocalDate day) {
        if (!memberships.existsByIdTeamIdAndIdUserId(teamId, requesterUserId)) {
            throw new NotATeamMemberException();
        }
        List<TeamMember> rows = memberships.findAllByIdTeamId(teamId);
        if (rows.isEmpty()) return List.of();

        List<Long> userIds = rows.stream().map(TeamMember::userId).toList();
        Map<Long, User> usersById = new HashMap<>();
        for (User u : users.findAllById(userIds)) {
            usersById.put(u.getId(), u);
        }

        // 점수 desc, 동률 시 userId asc — 안정적 tiebreaker로 클라가 깜빡이지 않게.
        record Scored(long userId, long score, String displayName, String avatarUrl) {}
        List<Scored> scored = new ArrayList<>(userIds.size());
        for (long uid : userIds) {
            User u = usersById.get(uid);
            if (u == null) continue;
            long s = stats.getTodayTokens(uid, day);
            scored.add(new Scored(uid, s, u.getDisplayName(), u.getAvatarUrl()));
        }
        scored.sort(Comparator.<Scored>comparingLong(Scored::score).reversed()
            .thenComparingLong(Scored::userId));

        // Competition rank — 동점은 같은 등수, 다음 등수는 그만큼 skip (1, 2, 2, 4 ...)
        List<LeaderboardEntry> result = new ArrayList<>(scored.size());
        int rank = 0;
        long prevScore = Long.MIN_VALUE;
        for (int i = 0; i < scored.size(); i++) {
            Scored s = scored.get(i);
            if (s.score() != prevScore) {
                rank = i + 1;
                prevScore = s.score();
            }
            result.add(new LeaderboardEntry(rank, s.userId(), s.displayName(), s.avatarUrl(), s.score()));
        }
        return result;
    }

    public record LeaderboardEntry(
        int rank,
        long userId,
        String displayName,
        String avatarUrl,
        long score
    ) {}
}
