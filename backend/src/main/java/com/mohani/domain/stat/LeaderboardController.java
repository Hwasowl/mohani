package com.mohani.domain.stat;

import com.mohani.domain.stat.LeaderboardService.LeaderboardEntry;
import com.mohani.global.auth.AuthenticatedUser;
import java.time.LocalDate;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

// Phase 1: metric=tokens, window=today만 지원. 향후 7d/30d, activities/toolUse 추가 예정.
@RestController
@RequestMapping("/api/v1/teams")
public class LeaderboardController {

    private final LeaderboardService service;

    public LeaderboardController(LeaderboardService service) {
        this.service = service;
    }

    @GetMapping("/{teamId}/leaderboard")
    public List<LeaderboardEntry> leaderboard(
        AuthenticatedUser user,
        @PathVariable Long teamId,
        @RequestParam(required = false, defaultValue = "tokens") String metric,
        @RequestParam(required = false, defaultValue = "today") String window
    ) {
        // 향후 metric/window 분기 추가. 지금은 모르는 값이 와도 today/tokens로 처리.
        return service.tokenLeaderboard(teamId, user.userId(), LocalDate.now());
    }
}
