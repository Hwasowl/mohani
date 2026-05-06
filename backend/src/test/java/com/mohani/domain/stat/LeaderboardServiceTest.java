package com.mohani.domain.stat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.mohani.domain.auth.User;
import com.mohani.domain.auth.UserRepository;
import com.mohani.domain.stat.LeaderboardService.LeaderboardEntry;
import com.mohani.domain.team.TeamMember;
import com.mohani.domain.team.TeamMemberRepository;
import com.mohani.domain.team.exception.NotATeamMemberException;
import java.lang.reflect.Field;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LeaderboardServiceTest {

    @Mock TeamMemberRepository memberships;
    @Mock UserRepository users;
    @Mock StatService stats;

    LeaderboardService service;
    final LocalDate today = LocalDate.of(2026, 5, 6);

    @BeforeEach
    void wire() {
        service = new LeaderboardService(memberships, users, stats);
    }

    @Test
    void nonMemberRequester_throws() {
        when(memberships.existsByIdTeamIdAndIdUserId(100L, 999L)).thenReturn(false);

        assertThatThrownBy(() -> service.tokenLeaderboard(100L, 999L, today))
            .isInstanceOf(NotATeamMemberException.class);
    }

    @Test
    void emptyTeam_returnsEmptyList() {
        when(memberships.existsByIdTeamIdAndIdUserId(100L, 7L)).thenReturn(true);
        when(memberships.findAllByIdTeamId(100L)).thenReturn(List.of());

        assertThat(service.tokenLeaderboard(100L, 7L, today)).isEmpty();
    }

    @Test
    void singleMember_isRankOne() throws Exception {
        setupTeam(100L, 7L, List.of(7L));
        when(users.findAllById(any())).thenReturn(List.of(user(7L, "혼자", "img")));
        when(stats.getTodayTokens(7L, today)).thenReturn(50L);

        List<LeaderboardEntry> result = service.tokenLeaderboard(100L, 7L, today);
        assertThat(result).hasSize(1);
        assertThat(result.get(0).rank()).isEqualTo(1);
        assertThat(result.get(0).userId()).isEqualTo(7L);
        assertThat(result.get(0).displayName()).isEqualTo("혼자");
        assertThat(result.get(0).avatarUrl()).isEqualTo("img");
        assertThat(result.get(0).score()).isEqualTo(50L);
    }

    @Test
    void multipleMembers_sortedByScoreDesc() throws Exception {
        setupTeam(100L, 7L, List.of(7L, 8L, 9L));
        when(users.findAllById(any())).thenReturn(List.of(
            user(7L, "A", null), user(8L, "B", null), user(9L, "C", null)
        ));
        when(stats.getTodayTokens(7L, today)).thenReturn(20L);
        when(stats.getTodayTokens(8L, today)).thenReturn(100L);
        when(stats.getTodayTokens(9L, today)).thenReturn(50L);

        List<LeaderboardEntry> result = service.tokenLeaderboard(100L, 7L, today);
        assertThat(result).extracting(LeaderboardEntry::userId).containsExactly(8L, 9L, 7L);
        assertThat(result).extracting(LeaderboardEntry::rank).containsExactly(1, 2, 3);
        assertThat(result).extracting(LeaderboardEntry::score).containsExactly(100L, 50L, 20L);
    }

    @Test
    void ties_useCompetitionRank_andUserIdAscendingTiebreaker() throws Exception {
        setupTeam(100L, 7L, List.of(7L, 8L, 9L, 10L));
        when(users.findAllById(any())).thenReturn(List.of(
            user(7L, "A", null), user(8L, "B", null), user(9L, "C", null), user(10L, "D", null)
        ));
        when(stats.getTodayTokens(7L, today)).thenReturn(100L);
        when(stats.getTodayTokens(8L, today)).thenReturn(50L);
        when(stats.getTodayTokens(9L, today)).thenReturn(50L);
        when(stats.getTodayTokens(10L, today)).thenReturn(20L);

        List<LeaderboardEntry> result = service.tokenLeaderboard(100L, 7L, today);
        // competition rank: 100→1, 50/50→2/2 (skip 3), 20→4
        assertThat(result).extracting(LeaderboardEntry::rank).containsExactly(1, 2, 2, 4);
        // 동률 시 userId 오름차순 — 8 → 9 순서
        assertThat(result.get(1).userId()).isEqualTo(8L);
        assertThat(result.get(2).userId()).isEqualTo(9L);
    }

    @Test
    void zeroScoreMembers_appearAtBottomWithRank() throws Exception {
        setupTeam(100L, 7L, List.of(7L, 8L));
        when(users.findAllById(any())).thenReturn(List.of(
            user(7L, "A", null), user(8L, "B", null)
        ));
        when(stats.getTodayTokens(7L, today)).thenReturn(100L);
        when(stats.getTodayTokens(8L, today)).thenReturn(0L);

        List<LeaderboardEntry> result = service.tokenLeaderboard(100L, 7L, today);
        assertThat(result).hasSize(2);
        assertThat(result.get(0).userId()).isEqualTo(7L);
        assertThat(result.get(0).score()).isEqualTo(100L);
        assertThat(result.get(1).userId()).isEqualTo(8L);
        assertThat(result.get(1).score()).isZero();
        assertThat(result.get(1).rank()).isEqualTo(2);
    }

    @Test
    void allZeroScores_allTiedAtRankOne() throws Exception {
        setupTeam(100L, 7L, List.of(7L, 8L));
        when(users.findAllById(any())).thenReturn(List.of(
            user(7L, "A", null), user(8L, "B", null)
        ));
        when(stats.getTodayTokens(7L, today)).thenReturn(0L);
        when(stats.getTodayTokens(8L, today)).thenReturn(0L);

        List<LeaderboardEntry> result = service.tokenLeaderboard(100L, 7L, today);
        assertThat(result).extracting(LeaderboardEntry::rank).containsExactly(1, 1);
    }

    @Test
    void requesterCanBeRankedToo_notExcluded() throws Exception {
        // 본인이 1등인 경우도 leaderboard에 그대로 포함
        setupTeam(100L, 7L, List.of(7L, 8L));
        when(users.findAllById(any())).thenReturn(List.of(
            user(7L, "나", null), user(8L, "남", null)
        ));
        when(stats.getTodayTokens(7L, today)).thenReturn(200L);
        when(stats.getTodayTokens(8L, today)).thenReturn(50L);

        List<LeaderboardEntry> result = service.tokenLeaderboard(100L, 7L, today);
        assertThat(result.get(0).userId()).isEqualTo(7L);
        assertThat(result.get(0).rank()).isEqualTo(1);
    }

    private void setupTeam(long teamId, long requesterUserId, List<Long> memberIds) {
        when(memberships.existsByIdTeamIdAndIdUserId(teamId, requesterUserId)).thenReturn(true);
        when(memberships.findAllByIdTeamId(teamId)).thenReturn(
            memberIds.stream().map(uid -> TeamMember.member(teamId, uid)).toList()
        );
    }

    private static User user(long id, String name, String avatar) throws Exception {
        User u = User.newAnonymous("dev-" + id, name);
        if (avatar != null) u.setAvatarUrl(avatar);
        Field f = User.class.getDeclaredField("id");
        f.setAccessible(true);
        f.set(u, id);
        return u;
    }
}
