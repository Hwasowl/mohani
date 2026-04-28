package com.mohani.domain.activity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mohani.domain.activity.ActivityIngestService.IngestResult;
import com.mohani.domain.auth.User;
import com.mohani.domain.auth.UserRepository;
import com.mohani.domain.stat.StatService;
import com.mohani.domain.team.Team;
import com.mohani.domain.team.TeamMember;
import com.mohani.domain.team.TeamMemberRepository;
import com.mohani.domain.team.TeamRepository;
import java.lang.reflect.Field;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.messaging.simp.SimpMessagingTemplate;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ActivityIngestServiceTest {

    @Mock ActivityLogRepository activities;
    @Mock UserRepository users;
    @Mock TeamMemberRepository memberships;
    @Mock TeamRepository teams;
    @Mock StatService stats;
    @Mock SimpMessagingTemplate broker;

    MaskingPolicy masking = new MaskingPolicy();
    ActivityIngestService service;

    @BeforeEach
    void wire() throws Exception {
        service = new ActivityIngestService(activities, users, memberships, teams,
            masking, stats, broker);

        // 기본 stub: 사용자 1명, 팀 1개에 소속, 팀코드 ABC123
        User u = User.newAnonymous("dev-1", "테스터");
        setId(u, 7L);
        when(users.findById(7L)).thenReturn(Optional.of(u));

        Team t = Team.create("ABC123", "team", 7L);
        setId(t, 100L);
        when(teams.findById(100L)).thenReturn(Optional.of(t));

        when(memberships.findAllByIdUserId(7L)).thenReturn(
            List.of(TeamMember.member(100L, 7L))
        );

        when(stats.getTodayTokens(eq(7L), any())).thenReturn(0L);
        when(stats.getTodayDurationSec(eq(7L), any())).thenReturn(0L);
    }

    @Test
    void ingest_persistsAndBroadcastsForUserPromptSubmit() {
        ActivityEventDto evt = new ActivityEventDto(
            "UserPromptSubmit", "s1", "/tmp",
            "redis sorted set 페이징 도와줘",
            null, null, null,
            OffsetDateTime.now()
        );

        IngestResult result = service.ingest(7L, evt);
        assertThat(result).isInstanceOf(IngestResult.Accepted.class);

        verify(activities, times(1)).save(any(ActivityLog.class));

        ArgumentCaptor<TeamFeedMessage> msg = ArgumentCaptor.forClass(TeamFeedMessage.class);
        verify(broker, times(1)).convertAndSend(eq("/topic/team/ABC123"), msg.capture());
        assertThat(msg.getValue().promptFirstLine()).isEqualTo("redis sorted set 페이징 도와줘");
        assertThat(msg.getValue().displayName()).isEqualTo("테스터");
    }

    @Test
    void ingest_dropsWhenSuspiciousPatternBypassedAgent() {
        ActivityEventDto evt = new ActivityEventDto(
            "UserPromptSubmit", "s", null,
            "leaked AKIAIOSFODNN7EXAMPLE here", // raw AWS key
            null, null, null, OffsetDateTime.now()
        );

        IngestResult result = service.ingest(7L, evt);
        assertThat(result).isInstanceOf(IngestResult.Dropped.class);
        IngestResult.Dropped d = (IngestResult.Dropped) result;
        assertThat(d.reason()).isEqualTo("suspicious_after_mask");
        assertThat(d.patterns()).contains("AWS_KEY");

        verify(activities, never()).save(any());
        verify(broker, never()).convertAndSend(any(String.class), any(Object.class));
    }

    @Test
    void ingest_addsTokensAndDurationToStats() {
        ActivityEventDto evt = new ActivityEventDto(
            "Stop", "s", null, null, null, 1234L, 30,
            OffsetDateTime.now()
        );

        service.ingest(7L, evt);
        verify(stats, times(1)).addTokens(eq(7L), eq(1234L), any());
        verify(stats, times(1)).addDurationSec(eq(7L), eq(30L), any());
    }

    @Test
    void ingest_truncatesOver200chars() {
        String long300 = "a".repeat(300);
        ActivityEventDto evt = new ActivityEventDto(
            "UserPromptSubmit", "s", null, long300,
            null, null, null, OffsetDateTime.now()
        );

        ArgumentCaptor<ActivityLog> log = ArgumentCaptor.forClass(ActivityLog.class);
        service.ingest(7L, evt);
        verify(activities).save(log.capture());
        assertThat(log.getValue().getPromptFirstLine()).hasSize(200);
    }

    @Test
    void ingest_skipsBroadcastWhenNoTeamMembership() {
        when(memberships.findAllByIdUserId(7L)).thenReturn(List.of());

        ActivityEventDto evt = new ActivityEventDto(
            "UserPromptSubmit", "s", null, "hi", null, null, null, OffsetDateTime.now()
        );

        service.ingest(7L, evt);
        verify(activities, never()).save(any());
        verify(broker, never()).convertAndSend(any(String.class), any(Object.class));
    }

    private static void setId(Object entity, long id) throws Exception {
        Field f = entity.getClass().getDeclaredField("id");
        f.setAccessible(true);
        f.set(entity, id);
    }
}
