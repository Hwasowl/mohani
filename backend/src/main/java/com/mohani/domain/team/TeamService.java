package com.mohani.domain.team;

import com.mohani.domain.auth.User;
import com.mohani.domain.auth.UserRepository;
import com.mohani.domain.team.exception.NotATeamMemberException;
import com.mohani.domain.team.exception.TeamNotFoundException;
import com.mohani.global.error.BusinessException;
import com.mohani.global.error.ErrorCode;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TeamService {

    private static final int MAX_CODE_GEN_ATTEMPTS = 8;

    private final TeamRepository teams;
    private final TeamMemberRepository memberships;
    private final UserRepository users;
    private final TeamCodeGenerator codeGen;

    public TeamService(TeamRepository teams, TeamMemberRepository memberships,
                       UserRepository users, TeamCodeGenerator codeGen) {
        this.teams = teams;
        this.memberships = memberships;
        this.users = users;
        this.codeGen = codeGen;
    }

    @Transactional
    public TeamView create(Long ownerUserId, String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("team name is required");
        }
        String code = generateUniqueCode();
        Team team = teams.save(Team.create(code, name.trim(), ownerUserId));
        memberships.save(TeamMember.owner(team.getId(), ownerUserId));
        return TeamView.from(team);
    }

    @Transactional
    public TeamView join(Long userId, String teamCode) {
        Team team = teams.findByTeamCode(normalize(teamCode))
            .orElseThrow(() -> new TeamNotFoundException(teamCode));
        if (!memberships.existsByIdTeamIdAndIdUserId(team.getId(), userId)) {
            memberships.save(TeamMember.member(team.getId(), userId));
        }
        return TeamView.from(team);
    }

    @Transactional
    public LeaveResult leave(Long teamId, Long userId) {
        Team team = teams.findById(teamId)
            .orElseThrow(() -> new TeamNotFoundException(String.valueOf(teamId)));
        if (!memberships.existsByIdTeamIdAndIdUserId(teamId, userId)) {
            throw new NotATeamMemberException();
        }
        memberships.deleteByIdTeamIdAndIdUserId(teamId, userId);
        long remaining = memberships.countByIdTeamId(teamId);
        boolean teamDeleted = false;
        if (remaining == 0) {
            // 마지막 멤버가 나가면 팀 자체를 삭제 — 좀비 팀 방지
            teams.deleteById(teamId);
            teamDeleted = true;
        }
        return new LeaveResult(team.getTeamCode(), teamDeleted, remaining);
    }

    @Transactional(readOnly = true)
    public List<MemberView> listMembers(Long teamId, Long requesterUserId) {
        if (!memberships.existsByIdTeamIdAndIdUserId(teamId, requesterUserId)) {
            throw new NotATeamMemberException();
        }
        List<TeamMember> rows = memberships.findAllByIdTeamId(teamId);
        List<Long> userIds = rows.stream().map(TeamMember::userId).toList();
        return users.findAllById(userIds).stream()
            .map(MemberView::from)
            .toList();
    }

    @Transactional(readOnly = true)
    public List<TeamView> listMyTeams(Long userId) {
        List<Long> teamIds = memberships.findAllByIdUserId(userId).stream()
            .map(TeamMember::teamId)
            .toList();
        return teams.findAllById(teamIds).stream().map(TeamView::from).toList();
    }

    private String generateUniqueCode() {
        for (int i = 0; i < MAX_CODE_GEN_ATTEMPTS; i++) {
            String code = codeGen.next();
            if (!teams.existsByTeamCode(code)) return code;
        }
        throw new BusinessException(ErrorCode.TEAM_CODE_GENERATION,
            "could not generate unique team code in " + MAX_CODE_GEN_ATTEMPTS + " attempts");
    }

    private static String normalize(String code) {
        if (code == null) return null;
        return code.trim().toUpperCase();
    }

    public record TeamView(Long id, String teamCode, String name, Long ownerId) {
        public static TeamView from(Team t) {
            return new TeamView(t.getId(), t.getTeamCode(), t.getName(), t.getOwnerId());
        }
    }

    public record LeaveResult(String teamCode, boolean teamDeleted, long remainingMembers) {}

    public record MemberView(Long userId, String displayName, String avatarUrl) {
        public static MemberView from(User u) {
            return new MemberView(u.getId(), u.getDisplayName(), u.getAvatarUrl());
        }
    }
}
