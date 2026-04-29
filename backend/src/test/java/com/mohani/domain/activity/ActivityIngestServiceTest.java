package com.mohani.domain.activity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.domain.Pageable;
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

        // 기본: 미응답 turn 없음. 개별 테스트에서 override.
        when(activities.findUnansweredTurns(any(), any(), any(), any(), any(Pageable.class)))
            .thenReturn(List.of());
    }

    @Test
    void userPromptSubmit_persistsRowAndBroadcasts() {
        ActivityEventDto evt = userPrompt("redis sorted set 페이징 도와줘", null);

        IngestResult result = service.ingest(7L, evt);
        assertThat(result).isInstanceOf(IngestResult.Accepted.class);

        ArgumentCaptor<ActivityLog> log = ArgumentCaptor.forClass(ActivityLog.class);
        verify(activities, times(1)).save(log.capture());
        assertThat(log.getValue().getEventKind()).isEqualTo("UserPromptSubmit");
        assertThat(log.getValue().getPromptFirstLine()).isEqualTo("redis sorted set 페이징 도와줘");
        assertThat(log.getValue().getAssistantPreview()).isNull();

        ArgumentCaptor<TeamFeedMessage> msg = ArgumentCaptor.forClass(TeamFeedMessage.class);
        verify(broker, times(1)).convertAndSend(eq("/topic/team/ABC123"), msg.capture());
        assertThat(msg.getValue().promptFirstLine()).isEqualTo("redis sorted set 페이징 도와줘");
    }

    @Test
    void stop_attachesToUnansweredTurn_inPlaceUpdate() throws Exception {
        // 미응답 turn 1건 존재
        ActivityLog existing = ActivityLog.builder()
            .userId(7L).teamId(100L)
            .occurredAt(OffsetDateTime.now().minusMinutes(2))
            .promptFirstLine("질문 첫 줄").promptFull("질문 전체")
            .eventKind("UserPromptSubmit").cliKind("claude")
            .build();
        setId(existing, 555L);
        when(activities.findUnansweredTurns(eq(7L), eq(100L), eq("claude"), any(), any(Pageable.class)))
            .thenReturn(new ArrayList<>(List.of(existing)));

        ActivityEventDto stop = stopWithAnswer("답변 1\n답변 2\n답변 3", "답변 본문 전체", 3, 1234L);

        IngestResult result = service.ingest(7L, stop);
        assertThat(result).isInstanceOf(IngestResult.Accepted.class);

        // 새 row 저장 안 함 — 기존 row를 in-place update
        verify(activities, never()).save(any(ActivityLog.class));
        assertThat(existing.getAssistantPreview()).isEqualTo("답변 1\n답변 2\n답변 3");
        assertThat(existing.getAssistantFull()).isEqualTo("답변 본문 전체");
        assertThat(existing.getToolUseCount()).isEqualTo(3);
        assertThat(existing.getResponseTokens()).isEqualTo(1234);

        // 브로드캐스트는 발생 — 답변이 실린 메시지
        ArgumentCaptor<TeamFeedMessage> msg = ArgumentCaptor.forClass(TeamFeedMessage.class);
        verify(broker).convertAndSend(eq("/topic/team/ABC123"), msg.capture());
        assertThat(msg.getValue().assistantPreview()).isEqualTo("답변 1\n답변 2\n답변 3");
    }

    @Test
    void stop_withoutMatchingTurn_insertsNewRowWhenAssistantPresent() {
        ActivityEventDto stop = stopWithAnswer("외로운 답변", "외로운 답변 본문", 0, 100L);
        service.ingest(7L, stop);

        ArgumentCaptor<ActivityLog> log = ArgumentCaptor.forClass(ActivityLog.class);
        verify(activities, times(1)).save(log.capture());
        assertThat(log.getValue().getEventKind()).isEqualTo("Stop");
        assertThat(log.getValue().getPromptFirstLine()).isNull();
        assertThat(log.getValue().getAssistantPreview()).isEqualTo("외로운 답변");
    }

    @Test
    void stop_withoutAnyAnswer_doesNotPersistButStillBroadcasts() {
        // assistant 정보가 전혀 없는 Stop — 응답 토큰만 있는 케이스
        ActivityEventDto stop = new ActivityEventDto(
            "Stop", "s1", null, null, null, null, null, null, null,
            500L, 30, "claude", OffsetDateTime.now()
        );
        service.ingest(7L, stop);

        verify(activities, never()).save(any(ActivityLog.class));
        verify(broker, times(1)).convertAndSend(eq("/topic/team/ABC123"), any(Object.class));
        verify(stats, times(1)).addTokens(eq(7L), eq(500L), any());
    }

    @Test
    void preToolUse_doesNotPersistRow_butUpdatesStats() {
        ActivityEventDto evt = new ActivityEventDto(
            "PreToolUse", "s1", null, null, null, null, null, null, "Bash",
            null, 5, "claude", OffsetDateTime.now()
        );
        service.ingest(7L, evt);

        verify(activities, never()).save(any(ActivityLog.class));
        verify(stats).addDurationSec(eq(7L), eq(5L), any());
        // 카드 lastSeen 갱신을 위해 broadcast는 발생
        verify(broker, times(1)).convertAndSend(eq("/topic/team/ABC123"), any(Object.class));
    }

    @Test
    void suspiciousInPromptFull_dropsEntireEvent() {
        ActivityEventDto evt = new ActivityEventDto(
            "UserPromptSubmit", "s1", null, "안전한 첫 줄",
            "안전 첫줄\n그런데 본문에 leaked AKIAIOSFODNN7EXAMPLE here",
            null, null, null, null, null, null, "claude", OffsetDateTime.now()
        );

        IngestResult result = service.ingest(7L, evt);
        assertThat(result).isInstanceOf(IngestResult.Dropped.class);
        assertThat(((IngestResult.Dropped) result).patterns()).contains("AWS_KEY");
        verify(activities, never()).save(any(ActivityLog.class));
    }

    @Test
    void overlongPromptFull_isTruncatedTo50KB() {
        String huge = "가".repeat(100_000);
        ActivityEventDto evt = userPrompt("ok", huge);
        service.ingest(7L, evt);

        ArgumentCaptor<ActivityLog> log = ArgumentCaptor.forClass(ActivityLog.class);
        verify(activities).save(log.capture());
        assertThat(log.getValue().getPromptFull().length()).isEqualTo(MaskingPolicy.MAX_FULL_LEN);
    }

    @Test
    void noTeamMembership_persistsNothing() {
        when(memberships.findAllByIdUserId(7L)).thenReturn(List.of());

        ActivityEventDto evt = userPrompt("hi", null);
        service.ingest(7L, evt);

        verify(activities, never()).save(any());
        verify(broker, never()).convertAndSend(any(String.class), any(Object.class));
    }

    private static ActivityEventDto userPrompt(String firstLine, String full) {
        return new ActivityEventDto(
            "UserPromptSubmit", "s1", "/tmp", firstLine, full,
            null, null, null, null, null, null, "claude", OffsetDateTime.now()
        );
    }

    private static ActivityEventDto stopWithAnswer(String preview, String full, int toolUse, Long tokens) {
        return new ActivityEventDto(
            "Stop", "s1", null, null, null,
            preview, full, toolUse, null, tokens, null, "claude", OffsetDateTime.now()
        );
    }

    private static void setId(Object entity, long id) throws Exception {
        Field f = entity.getClass().getDeclaredField("id");
        f.setAccessible(true);
        f.set(entity, id);
    }
}
