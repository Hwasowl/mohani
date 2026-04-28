package com.mohani.domain.team;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "teams")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Team {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "team_code", unique = true, nullable = false, length = 6)
    private String teamCode;

    @Column(nullable = false, length = 64)
    private String name;

    @Column(name = "owner_id", nullable = false)
    private Long ownerId;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Builder
    private Team(Long id, String teamCode, String name, Long ownerId, OffsetDateTime createdAt) {
        this.id = id;
        this.teamCode = teamCode;
        this.name = name;
        this.ownerId = ownerId;
        this.createdAt = createdAt;
    }

    public static Team create(String teamCode, String name, Long ownerId) {
        return Team.builder()
            .teamCode(teamCode)
            .name(name)
            .ownerId(ownerId)
            .createdAt(OffsetDateTime.now())
            .build();
    }
}
