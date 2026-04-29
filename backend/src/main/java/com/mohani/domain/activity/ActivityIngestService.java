package com.mohani.domain.activity;

import com.mohani.domain.auth.User;
import com.mohani.domain.auth.UserRepository;
import com.mohani.domain.stat.StatService;
import com.mohani.domain.team.Team;
import com.mohani.domain.team.TeamMember;
import com.mohani.domain.team.TeamMemberRepository;
import com.mohani.domain.team.TeamRepository;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ActivityIngestService {

    // turn 매칭 시간 창 — Stop이 UserPromptSubmit과 짝이 되려면 이 안에 도착해야 한다.
    private static final Duration TURN_MATCH_WINDOW = Duration.ofMinutes(15);

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
        // 1. 마스킹 재검증 — 첫 줄, 전체 본문, 답변 모두에 의심 패턴이 있으면 drop
        String firstLine = masking.enforceFirstLine(event.promptFirstLine());
        String promptFull = masking.enforceFull(event.promptFull());
        String assistantPreview = masking.enforcePreview(event.assistantPreview());
        String assistantFull = masking.enforceFull(event.assistantFull());

        List<String> suspicious = new ArrayList<>();
        suspicious.addAll(masking.detectSuspicious(firstLine));
        suspicious.addAll(masking.detectSuspicious(promptFull));
        suspicious.addAll(masking.detectSuspicious(assistantPreview));
        suspicious.addAll(masking.detectSuspicious(assistantFull));
        if (!suspicious.isEmpty()) {
            return IngestResult.dropped("suspicious_after_mask", suspicious);
        }

        OffsetDateTime occurredAt = event.occurredAt() != null ? event.occurredAt() : OffsetDateTime.now();
        LocalDate day = occurredAt.atZoneSameInstant(ZoneId.systemDefault()).toLocalDate();
        String cliKind = event.cliKind() == null || event.cliKind().isBlank() ? "claude" : event.cliKind();

        // 2. 통계 갱신 (Redis) — 모든 이벤트에 적용
        if (event.totalTokens() != null && event.totalTokens() > 0) {
            stats.addTokens(userId, event.totalTokens(), day);
        }
        if (event.durationDeltaSec() != null && event.durationDeltaSec() > 0) {
            stats.addDurationSec(userId, event.durationDeltaSec(), day);
        }

        User user = users.findById(userId).orElseThrow();
        long todayTokens = stats.getTodayTokens(userId, day);
        long todayDurationSec = stats.getTodayDurationSec(userId, day);
        List<TeamMember> myTeams = memberships.findAllByIdUserId(userId);

        String eventKind = event.event();
        boolean isPrompt = "UserPromptSubmit".equals(eventKind);
        boolean isStop = "Stop".equals(eventKind);

        // 3. 활동 로그 row 작성/갱신은 turn에 의미 있는 이벤트만 (UserPromptSubmit / Stop)
        //    그 외 이벤트(PreToolUse 등)는 통계 + WSS 활동 표시만
        int persistedRows = 0;
        for (TeamMember m : myTeams) {
            ActivityLog row = null;
            if (isPrompt && firstLine != null && !firstLine.isEmpty()) {
                row = ActivityLog.builder()
                    .userId(userId)
                    .teamId(m.teamId())
                    .occurredAt(occurredAt)
                    .promptFirstLine(firstLine)
                    .promptFull(promptFull)
                    .eventKind("UserPromptSubmit")
                    .cliKind(cliKind)
                    .build();
                activities.save(row);
                persistedRows++;
            } else if (isStop) {
                // 같은 (user, team, cli) 에서 미응답 turn 찾아서 합침. 없으면 답변만 있는 row 추가.
                OffsetDateTime since = occurredAt.minus(TURN_MATCH_WINDOW);
                List<ActivityLog> candidates = activities.findUnansweredTurns(
                    userId, m.teamId(), cliKind, since, PageRequest.of(0, 1));
                if (!candidates.isEmpty() && (assistantPreview != null || assistantFull != null)) {
                    ActivityLog target = candidates.get(0);
                    target.attachAssistantTurn(assistantPreview, assistantFull,
                        toolUseCountOf(event), responseTokensOf(event));
                    row = target;
                    persistedRows++;
                } else if (assistantPreview != null) {
                    // 짝맞는 prompt가 없어도 답변만으로도 의미 있을 수 있음 — 별도 row로 보존
                    row = ActivityLog.builder()
                        .userId(userId)
                        .teamId(m.teamId())
                        .occurredAt(occurredAt)
                        .assistantPreview(assistantPreview)
                        .assistantFull(assistantFull)
                        .toolUseCount(toolUseCountOf(event))
                        .responseTokens(responseTokensOf(event))
                        .eventKind("Stop")
                        .cliKind(cliKind)
                        .build();
                    activities.save(row);
                    persistedRows++;
                }
            }

            // 4. WSS — 의미 있는 이벤트(UserPromptSubmit 또는 답변이 합쳐진 Stop)만 fanout.
            //    나머지(잡음 이벤트 + 답변 없는 Stop)는 카드 lastSeen만 갱신용으로 broadcast.
            Team team = teams.findById(m.teamId()).orElseThrow();
            String broadcastFirstLine = (row != null) ? row.getPromptFirstLine() : firstLine;
            String broadcastAssistantPreview = (row != null) ? row.getAssistantPreview() : assistantPreview;
            TeamFeedMessage msg = new TeamFeedMessage(
                eventKind,
                userId,
                user.getDisplayName(),
                user.getAvatarUrl(),
                broadcastFirstLine,
                broadcastAssistantPreview,
                event.toolName(),
                cliKind,
                todayTokens,
                todayDurationSec,
                occurredAt
            );
            broker.convertAndSend("/topic/team/" + team.getTeamCode(), msg);
        }

        return IngestResult.accepted(myTeams.size(), todayTokens, todayDurationSec, persistedRows);
    }

    private static int toolUseCountOf(ActivityEventDto e) {
        return e.toolUseCount() == null ? 0 : Math.max(0, e.toolUseCount());
    }

    private static int responseTokensOf(ActivityEventDto e) {
        return e.totalTokens() == null ? 0 : (int) Math.min(Integer.MAX_VALUE, Math.max(0, e.totalTokens()));
    }

    public sealed interface IngestResult {
        record Accepted(int teamFanout, long todayTokens, long todayDurationSec, int persistedRows) implements IngestResult {}
        record Dropped(String reason, List<String> patterns) implements IngestResult {}

        static Accepted accepted(int fanout, long tokens, long duration, int rows) {
            return new Accepted(fanout, tokens, duration, rows);
        }
        static Dropped dropped(String reason, List<String> patterns) {
            return new Dropped(reason, patterns);
        }
    }
}
