package com.mohani.domain.team;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TeamRepository extends JpaRepository<Team, Long> {

    Optional<Team> findByTeamCode(String teamCode);

    boolean existsByTeamCode(String teamCode);
}
