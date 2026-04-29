package com.mohani.domain.stat;

import com.mohani.domain.stat.TeamStatsService.TodayStat;
import com.mohani.global.auth.AuthenticatedUser;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/teams")
public class TeamStatsController {

    private final TeamStatsService service;

    public TeamStatsController(TeamStatsService service) {
        this.service = service;
    }

    @GetMapping("/{teamId}/today-stats")
    public List<TodayStat> todayStats(AuthenticatedUser user, @PathVariable Long teamId) {
        return service.todayStats(teamId, user.userId());
    }
}
