package com.mohani.domain.activity;

import com.mohani.domain.activity.ActivityHistoryService.ActivityHistoryItem;
import com.mohani.global.auth.AuthenticatedUser;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/activity")
public class ActivityHistoryController {

    private final ActivityHistoryService service;

    public ActivityHistoryController(ActivityHistoryService service) {
        this.service = service;
    }

    @GetMapping
    public List<ActivityHistoryItem> recent(
        AuthenticatedUser user,
        @RequestParam Long teamId,
        @RequestParam Long userId,
        @RequestParam(required = false) Integer limit
    ) {
        return service.recentByMember(teamId, userId, user.userId(), limit);
    }
}
