package com.mohani.domain.team;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TeamMemberRepository extends JpaRepository<TeamMember, TeamMemberId> {

    List<TeamMember> findAllByIdTeamId(Long teamId);

    List<TeamMember> findAllByIdUserId(Long userId);

    boolean existsByIdTeamIdAndIdUserId(Long teamId, Long userId);

    long countByIdTeamId(Long teamId);

    void deleteByIdTeamIdAndIdUserId(Long teamId, Long userId);
}
