package com.mohani.domain.activity;

import com.mohani.domain.activity.ActivityIngestService.IngestResult;
import com.mohani.global.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/agent")
public class ActivityIngestController {

    private final ActivityIngestService service;

    public ActivityIngestController(ActivityIngestService service) {
        this.service = service;
    }

    @PostMapping("/events")
    public IngestResponse ingest(AuthenticatedUser user, @Valid @RequestBody ActivityEventDto event) {
        IngestResult r = service.ingest(user.userId(), event);
        if (r instanceof IngestResult.Accepted a) {
            return new IngestResponse(true, null, a.teamFanout(), a.todayTokens(), a.todayDurationSec());
        }
        IngestResult.Dropped d = (IngestResult.Dropped) r;
        return new IngestResponse(false, d.reason(), 0, 0L, 0L);
    }

    public record IngestResponse(boolean accepted, String dropReason,
                                 int teamFanout, long todayTokens, long todayDurationSec) {
    }
}
