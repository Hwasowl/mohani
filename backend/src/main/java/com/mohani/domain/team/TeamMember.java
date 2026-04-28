package com.mohani.domain.team;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "team_members")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class TeamMember {

    @EmbeddedId
    private TeamMemberId id;

    @Column(nullable = false, length = 16)
    private String role;

    @Column(name = "joined_at", nullable = false)
    private OffsetDateTime joinedAt;

    @Builder
    private TeamMember(TeamMemberId id, String role, OffsetDateTime joinedAt) {
        this.id = id;
        this.role = role;
        this.joinedAt = joinedAt;
    }

    public Long teamId() { return id.getTeamId(); }
    public Long userId() { return id.getUserId(); }

    public static TeamMember owner(Long teamId, Long userId) {
        return TeamMember.builder()
            .id(new TeamMemberId(teamId, userId))
            .role("owner")
            .joinedAt(OffsetDateTime.now())
            .build();
    }

    public static TeamMember member(Long teamId, Long userId) {
        return TeamMember.builder()
            .id(new TeamMemberId(teamId, userId))
            .role("member")
            .joinedAt(OffsetDateTime.now())
            .build();
    }
}
