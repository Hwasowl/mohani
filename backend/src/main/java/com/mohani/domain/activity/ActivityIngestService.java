package com.mohani.domain.activity;

import com.mohani.domain.auth.User;
import com.mohani.domain.auth.UserRepository;
import com.mohani.domain.stat.StatService;
import com.mohani.domain.team.Team;
import com.mohani.domain.team.TeamMember;
import com.mohani.domain.team.TeamMemberRepository;
import com.mohani.domain.team.TeamRepository;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ActivityIngestService {

    private final ActivityLogRepository activities;
    private final UserRepository users;
    private final TeamMemberRepository memberships;
    private final TeamRepository teams;
    private final MaskingPolicy masking;
    private final StatService stats;
    private final SimpMessagingTemplate broker;

    public ActivityIngestService(ActivityLogRepository activities,
                                 UserRepository users,
                                 TeamMemberRepository memberships,
                                 TeamRepository teams,
                                 MaskingPolicy masking,
                                 StatService stats,
                                 SimpMessagingTemplate broker) {
        this.activities = activities;
        this.users = users;
        this.memberships = memberships;
        this.teams = teams;
        this.masking = masking;
        this.stats = stats;
        this.broker = broker;
    }

    @Transactional
    public IngestResult ingest(long userId, ActivityEventDto event) {
        // 1. 마스킹 재검증 (Local Agent 우회 방어)
        String firstLine = masking.enforceFirstLine(event.promptFirstLine());
        List<String> suspicious = masking.detectSuspicious(firstLine);
        if (!suspicious.isEmpty()) {
            return IngestResult.dropped("suspicious_after_mask", suspicious);
        }

        OffsetDateTime occurredAt = event.occurredAt() != null ? event.occurredAt() : OffsetDateTime.now();
        LocalDate day = occurredAt.atZoneSameInstant(ZoneId.systemDefault()).toLocalDate();

        // 2. 통계 갱신 (Redis)
        if (event.totalTokens() != null && event.totalTokens() > 0) {
            stats.addTokens(userId, event.totalTokens(), day);
        }
        if (event.durationDeltaSec() != null && event.durationDeltaSec() > 0) {
            stats.addDurationSec(userId, event.durationDeltaSec(), day);
        }

        // 3. 사용자 소속 팀 모두에 영구 저장 + 브로드캐스트
        User user = users.findById(userId).orElseThrow();
        long todayTokens = stats.getTodayTokens(userId, day);
        long todayDurationSec = stats.getTodayDurationSec(userId, day);
        List<TeamMember> myTeams = memberships.findAllByIdUserId(userId);

        String cliKind = event.cliKind() == null || event.cliKind().isBlank() ? "claude" : event.cliKind();
        for (TeamMember m : myTeams) {
            ActivityLog row = ActivityLog.builder()
                .userId(userId)
                .teamId(m.teamId())
                .occurredAt(occurredAt)
                .promptFirstLine(firstLine)
                .eventKind(event.event())
                .cliKind(cliKind)
                .build();
            activities.save(row);

            Team team = teams.findById(m.teamId()).orElseThrow();
            TeamFeedMessage msg = new TeamFeedMessage(
                event.event(),
                userId,
                user.getDisplayName(),
                firstLine,
                event.toolName(),
                cliKind,
                todayTokens,
                todayDurationSec,
                occurredAt
            );
            broker.convertAndSend("/topic/team/" + team.getTeamCode(), msg);
        }

        return IngestResult.accepted(myTeams.size(), todayTokens, todayDurationSec);
    }

    public sealed interface IngestResult {
        record Accepted(int teamFanout, long todayTokens, long todayDurationSec) implements IngestResult {}
        record Dropped(String reason, List<String> patterns) implements IngestResult {}

        static Accepted accepted(int fanout, long tokens, long duration) {
            return new Accepted(fanout, tokens, duration);
        }
        static Dropped dropped(String reason, List<String> patterns) {
            return new Dropped(reason, patterns);
        }
    }
}
