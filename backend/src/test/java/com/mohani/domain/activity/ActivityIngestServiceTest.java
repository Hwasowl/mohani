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
            500L, 30, "claude", null, null, OffsetDateTime.now()
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
            null, 5, "claude", null, null, OffsetDateTime.now()
        );
        service.ingest(7L, evt);

        verify(activities, never()).save(any(ActivityLog.class));
        verify(stats).addDurationSec(eq(7L), eq(5L), any());
        // 카드 lastSeen 갱신을 위해 broadcast는 발생
        verify(broker, times(1)).convertAndSend(eq("/topic/team/ABC123"), any(Object.class));
    }

    // H3 정책 변경: 본문에 비밀이 섞여 와도 drop 대신 redact 후 저장.
    // (drop은 redact가 못 잡은 비정상 케이스 안전망으로만 동작)
    @Test
    void secretInPromptFull_isRedactedAndPersisted() {
        ActivityEventDto evt = new ActivityEventDto(
            "UserPromptSubmit", "s1", null, "안전한 첫 줄",
            "안전 첫줄\n그런데 본문에 leaked AKIAIOSFODNN7EXAMPLE here",
            null, null, null, null, null, null, "claude",
            null, null, OffsetDateTime.now()
        );

        IngestResult result = service.ingest(7L, evt);
        assertThat(result).isInstanceOf(IngestResult.Accepted.class);

        ArgumentCaptor<ActivityLog> log = ArgumentCaptor.forClass(ActivityLog.class);
        verify(activities, times(1)).save(log.capture());
        assertThat(log.getValue().getPromptFull())
            .doesNotContain("AKIAIOSFODNN7EXAMPLE")
            .contains("●●●AWS_KEY●●●");
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

    // ── 질문/답변 숨김 토글 (활동 자체는 송신, 본문만 redact) ──

    @Test
    void userPromptSubmit_questionHidden_persistsRowWithNullBodyAndFlag() {
        ActivityEventDto evt = userPrompt("민감 첫 줄", "민감 본문", true);

        service.ingest(7L, evt);

        ArgumentCaptor<ActivityLog> log = ArgumentCaptor.forClass(ActivityLog.class);
        verify(activities, times(1)).save(log.capture());
        // 본문 NULL이지만 자리는 보존 — eventKind는 그대로
        assertThat(log.getValue().getEventKind()).isEqualTo("UserPromptSubmit");
        assertThat(log.getValue().getPromptFirstLine()).isNull();
        assertThat(log.getValue().getPromptFull()).isNull();
        assertThat(log.getValue().isQuestionHidden()).isTrue();
        assertThat(log.getValue().isAnswerHidden()).isFalse();

        ArgumentCaptor<TeamFeedMessage> msg = ArgumentCaptor.forClass(TeamFeedMessage.class);
        verify(broker, times(1)).convertAndSend(eq("/topic/team/ABC123"), msg.capture());
        assertThat(msg.getValue().questionHidden()).isTrue();
        assertThat(msg.getValue().promptFirstLine()).isNull();
    }

    @Test
    void stop_answerHidden_attachesToTurn_redactsAnswerKeepsTokens() throws Exception {
        // 미응답 turn 1건 존재
        ActivityLog existing = ActivityLog.builder()
            .userId(7L).teamId(100L)
            .occurredAt(OffsetDateTime.now().minusMinutes(2))
            .promptFirstLine("질문 첫 줄").promptFull("질문 전체")
            .eventKind("UserPromptSubmit").cliKind("claude")
            .questionHidden(false).answerHidden(false)
            .build();
        setId(existing, 555L);
        when(activities.findUnansweredTurns(eq(7L), eq(100L), eq("claude"), any(), any(Pageable.class)))
            .thenReturn(new ArrayList<>(List.of(existing)));

        // 답변 숨김 ON Stop — 클라가 답변 본문은 null로 보냄, answerHidden=true
        ActivityEventDto stop = stopWithAnswer(null, null, 3, 1500L, true);
        service.ingest(7L, stop);

        verify(activities, never()).save(any(ActivityLog.class)); // in-place update
        assertThat(existing.getAssistantPreview()).isNull();
        assertThat(existing.getAssistantFull()).isNull();
        assertThat(existing.isAnswerHidden()).isTrue();
        // 토큰/도구는 보존 (사용자 명시 요구)
        assertThat(existing.getResponseTokens()).isEqualTo(1500);
        assertThat(existing.getToolUseCount()).isEqualTo(3);

        ArgumentCaptor<TeamFeedMessage> msg = ArgumentCaptor.forClass(TeamFeedMessage.class);
        verify(broker).convertAndSend(eq("/topic/team/ABC123"), msg.capture());
        assertThat(msg.getValue().answerHidden()).isTrue();
        assertThat(msg.getValue().assistantPreview()).isNull();
        assertThat(msg.getValue().todayTokens()).isEqualTo(0L); // stub stat
    }

    @Test
    void stop_answerHidden_withoutMatchingTurn_insertsNewRow() {
        ActivityEventDto stop = stopWithAnswer(null, null, 0, 200L, true);

        service.ingest(7L, stop);

        ArgumentCaptor<ActivityLog> log = ArgumentCaptor.forClass(ActivityLog.class);
        verify(activities, times(1)).save(log.capture());
        assertThat(log.getValue().getEventKind()).isEqualTo("Stop");
        assertThat(log.getValue().getAssistantPreview()).isNull();
        assertThat(log.getValue().isAnswerHidden()).isTrue();
        assertThat(log.getValue().getResponseTokens()).isEqualTo(200);
    }

    @Test
    void serverEnforcesRedaction_evenIfClientSendsBodyByMistake() {
        // 방어층 — 클라가 questionHidden=true와 함께 본문도 보내도, 서버가 NULL로 강제.
        ActivityEventDto evt = new ActivityEventDto(
            "UserPromptSubmit", "s1", "/tmp", "어쩌다 본문", "어쩌다 전체",
            null, null, null, null, null, null, "claude",
            true, null, OffsetDateTime.now()
        );

        service.ingest(7L, evt);

        ArgumentCaptor<ActivityLog> log = ArgumentCaptor.forClass(ActivityLog.class);
        verify(activities, times(1)).save(log.capture());
        assertThat(log.getValue().getPromptFirstLine()).isNull();
        assertThat(log.getValue().getPromptFull()).isNull();
        assertThat(log.getValue().isQuestionHidden()).isTrue();
    }

    @Test
    void noFlags_defaultBroadcastsHiddenFalse_regression() {
        // 회귀 — 토글 안 켠 일반 경로에서 hidden 플래그가 모두 false로 전달되는지 확인.
        ActivityEventDto evt = userPrompt("평범한 질문", "본문");
        service.ingest(7L, evt);

        ArgumentCaptor<TeamFeedMessage> msg = ArgumentCaptor.forClass(TeamFeedMessage.class);
        verify(broker, times(1)).convertAndSend(eq("/topic/team/ABC123"), msg.capture());
        assertThat(msg.getValue().questionHidden()).isFalse();
        assertThat(msg.getValue().answerHidden()).isFalse();
    }

    private static ActivityEventDto userPrompt(String firstLine, String full) {
        return userPrompt(firstLine, full, false);
    }

    private static ActivityEventDto userPrompt(String firstLine, String full, boolean questionHidden) {
        return new ActivityEventDto(
            "UserPromptSubmit", "s1", "/tmp", firstLine, full,
            null, null, null, null, null, null, "claude",
            questionHidden, null, OffsetDateTime.now()
        );
    }

    private static ActivityEventDto stopWithAnswer(String preview, String full, int toolUse, Long tokens) {
        return stopWithAnswer(preview, full, toolUse, tokens, false);
    }

    private static ActivityEventDto stopWithAnswer(String preview, String full, int toolUse, Long tokens, boolean answerHidden) {
        return new ActivityEventDto(
            "Stop", "s1", null, null, null,
            preview, full, toolUse, null, tokens, null, "claude",
            null, answerHidden, OffsetDateTime.now()
        );
    }

    private static void setId(Object entity, long id) throws Exception {
        Field f = entity.getClass().getDeclaredField("id");
        f.setAccessible(true);
        f.set(entity, id);
    }
}
