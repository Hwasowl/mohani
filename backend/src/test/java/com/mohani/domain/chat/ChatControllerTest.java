package com.mohani.domain.chat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mohani.domain.auth.User;
import com.mohani.domain.auth.UserRepository;
import com.mohani.domain.team.Team;
import com.mohani.domain.team.TeamMemberRepository;
import com.mohani.domain.team.TeamRepository;
import com.mohani.global.auth.AuthenticatedUser;
import java.lang.reflect.Field;
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
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ChatControllerTest {

    @Mock TeamRepository teams;
    @Mock TeamMemberRepository memberships;
    @Mock UserRepository users;
    @Mock SimpMessagingTemplate broker;

    ChatController controller;
    UsernamePasswordAuthenticationToken memberPrincipal;
    UsernamePasswordAuthenticationToken nonMemberPrincipal;

    @BeforeEach
    void wire() throws Exception {
        controller = new ChatController(teams, memberships, users, broker);

        Team t = Team.create("ABC123", "team", 7L);
        setId(t, 100L);
        when(teams.findByTeamCode("ABC123")).thenReturn(Optional.of(t));

        User u = User.newAnonymous("dev-1", "테스터");
        setId(u, 7L);
        when(users.findById(7L)).thenReturn(Optional.of(u));

        when(memberships.existsByIdTeamIdAndIdUserId(100L, 7L)).thenReturn(true);
        when(memberships.existsByIdTeamIdAndIdUserId(100L, 999L)).thenReturn(false);

        memberPrincipal = new UsernamePasswordAuthenticationToken(
            new AuthenticatedUser(7L), "tok", List.of()
        );
        nonMemberPrincipal = new UsernamePasswordAuthenticationToken(
            new AuthenticatedUser(999L), "tok", List.of()
        );
    }

    @Test
    void member_sends_broadcastsToTopic() {
        controller.send("ABC123", new ChatInbound("안녕하세요"), memberPrincipal);

        ArgumentCaptor<ChatMessage> msg = ArgumentCaptor.forClass(ChatMessage.class);
        verify(broker, times(1)).convertAndSend(eq("/topic/team/ABC123/chat"), msg.capture());
        assertThat(msg.getValue().userId()).isEqualTo(7L);
        assertThat(msg.getValue().displayName()).isEqualTo("테스터");
        assertThat(msg.getValue().text()).isEqualTo("안녕하세요");
        assertThat(msg.getValue().sentAt()).isNotNull();
    }

    @Test
    void nonMember_send_isDropped() {
        controller.send("ABC123", new ChatInbound("끼어들기"), nonMemberPrincipal);
        verify(broker, never()).convertAndSend(any(String.class), any(Object.class));
    }

    @Test
    void blankOrNullText_isDropped() {
        controller.send("ABC123", new ChatInbound("   "), memberPrincipal);
        controller.send("ABC123", new ChatInbound(""), memberPrincipal);
        controller.send("ABC123", new ChatInbound(null), memberPrincipal);
        controller.send("ABC123", null, memberPrincipal);
        verify(broker, never()).convertAndSend(any(String.class), any(Object.class));
    }

    @Test
    void overlongText_isTruncatedTo1000() {
        String long1500 = "가".repeat(1500);
        controller.send("ABC123", new ChatInbound(long1500), memberPrincipal);

        ArgumentCaptor<ChatMessage> msg = ArgumentCaptor.forClass(ChatMessage.class);
        verify(broker).convertAndSend(eq("/topic/team/ABC123/chat"), msg.capture());
        assertThat(msg.getValue().text()).hasSize(ChatController.MAX_TEXT_LEN);
    }

    @Test
    void unknownTeam_isDropped() {
        controller.send("NOPE99", new ChatInbound("hi"), memberPrincipal);
        verify(broker, never()).convertAndSend(any(String.class), any(Object.class));
    }

    @Test
    void unauthenticatedPrincipal_isDropped() {
        controller.send("ABC123", new ChatInbound("hi"), null);
        verify(broker, never()).convertAndSend(any(String.class), any(Object.class));
    }

    private static void setId(Object entity, long id) throws Exception {
        Field f = entity.getClass().getDeclaredField("id");
        f.setAccessible(true);
        f.set(entity, id);
    }
}
