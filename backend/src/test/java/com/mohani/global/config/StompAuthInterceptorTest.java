package com.mohani.global.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.mohani.domain.team.Team;
import com.mohani.domain.team.TeamMemberRepository;
import com.mohani.domain.team.TeamRepository;
import com.mohani.global.auth.AuthenticatedUser;
import com.mohani.global.auth.JwtService;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageDeliveryException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

class StompAuthInterceptorTest {

    private JwtService jwt;
    private TeamRepository teams;
    private TeamMemberRepository memberships;
    private StompAuthInterceptor interceptor;

    @BeforeEach
    void setup() {
        jwt = mock(JwtService.class);
        teams = mock(TeamRepository.class);
        memberships = mock(TeamMemberRepository.class);
        interceptor = new StompAuthInterceptor(jwt, teams, memberships);
    }

    private static Message<?> buildMessage(StompHeaderAccessor acc) {
        // setUser 같은 mutation이 동일 헤더에 반영되도록 mutable로 유지.
        acc.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], acc.getMessageHeaders());
    }

    private static StompHeaderAccessor connect(String authHeader) {
        StompHeaderAccessor acc = StompHeaderAccessor.create(StompCommand.CONNECT);
        if (authHeader != null) acc.addNativeHeader("Authorization", authHeader);
        return acc;
    }

    private static StompHeaderAccessor subscribe(String destination, Long userId) {
        StompHeaderAccessor acc = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        acc.setDestination(destination);
        if (userId != null) {
            AuthenticatedUser u = new AuthenticatedUser(userId);
            acc.setUser(new UsernamePasswordAuthenticationToken(u, "tok", List.of()));
        }
        return acc;
    }

    private static Team teamWithId(long id, String code) {
        Team t = new Team() {};
        // Team 기본 생성자가 protected라 reflection으로 id 주입.
        try {
            Field idF = Team.class.getDeclaredField("id");
            idF.setAccessible(true);
            idF.set(t, id);
            Field codeF = Team.class.getDeclaredField("teamCode");
            codeF.setAccessible(true);
            codeF.set(t, code);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        return t;
    }

    @Test
    void connect_withValidJwt_setsPrincipal() {
        when(jwt.parseUserId("good-token")).thenReturn(42L);
        StompHeaderAccessor acc = connect("Bearer good-token");
        Message<?> result = interceptor.preSend(buildMessage(acc), null);
        StompHeaderAccessor out = MessageHeaderAccessor.getAccessor(result, StompHeaderAccessor.class);
        assertThat(out.getUser()).isNotNull();
        UsernamePasswordAuthenticationToken auth = (UsernamePasswordAuthenticationToken) out.getUser();
        assertThat(((AuthenticatedUser) auth.getPrincipal()).userId()).isEqualTo(42L);
    }

    @Test
    void connect_withInvalidJwt_proceedsAnonymously() {
        when(jwt.parseUserId(anyString())).thenThrow(new RuntimeException("bad"));
        StompHeaderAccessor acc = connect("Bearer invalid");
        Message<?> result = interceptor.preSend(buildMessage(acc), null);
        StompHeaderAccessor out = MessageHeaderAccessor.getAccessor(result, StompHeaderAccessor.class);
        assertThat(out.getUser()).isNull();
    }

    @Test
    void connect_withoutAuthHeader_proceedsAnonymously() {
        StompHeaderAccessor acc = connect(null);
        Message<?> result = interceptor.preSend(buildMessage(acc), null);
        StompHeaderAccessor out = MessageHeaderAccessor.getAccessor(result, StompHeaderAccessor.class);
        assertThat(result).isNotNull();
        assertThat(out.getUser()).isNull();
    }

    @Test
    void subscribe_anonymous_isDenied() {
        StompHeaderAccessor acc = subscribe("/topic/team/ABC123", null);
        assertThatThrownBy(() -> interceptor.preSend(buildMessage(acc), null))
            .isInstanceOf(MessageDeliveryException.class)
            .hasMessageContaining("not authenticated");
    }

    @Test
    void subscribe_member_isAllowed() {
        Team t = teamWithId(7L, "ABC123");
        when(teams.findByTeamCode("ABC123")).thenReturn(Optional.of(t));
        when(memberships.existsByIdTeamIdAndIdUserId(7L, 42L)).thenReturn(true);

        StompHeaderAccessor acc = subscribe("/topic/team/ABC123", 42L);
        Message<?> result = interceptor.preSend(buildMessage(acc), null);
        assertThat(result).isNotNull();
    }

    @Test
    void subscribe_nonMember_isDenied() {
        Team t = teamWithId(7L, "ABC123");
        when(teams.findByTeamCode("ABC123")).thenReturn(Optional.of(t));
        when(memberships.existsByIdTeamIdAndIdUserId(7L, 99L)).thenReturn(false);

        StompHeaderAccessor acc = subscribe("/topic/team/ABC123", 99L);
        assertThatThrownBy(() -> interceptor.preSend(buildMessage(acc), null))
            .isInstanceOf(MessageDeliveryException.class)
            .hasMessageContaining("not a member");
    }

    @Test
    void subscribe_chatTopic_appliesSameMembership() {
        Team t = teamWithId(7L, "ABC123");
        when(teams.findByTeamCode("ABC123")).thenReturn(Optional.of(t));
        when(memberships.existsByIdTeamIdAndIdUserId(7L, 42L)).thenReturn(true);

        StompHeaderAccessor acc = subscribe("/topic/team/ABC123/chat", 42L);
        Message<?> result = interceptor.preSend(buildMessage(acc), null);
        assertThat(result).isNotNull();
    }

    @Test
    void subscribe_typingTopic_appliesSameMembership_denyForNonMember() {
        Team t = teamWithId(7L, "ABC123");
        when(teams.findByTeamCode("ABC123")).thenReturn(Optional.of(t));
        when(memberships.existsByIdTeamIdAndIdUserId(7L, 99L)).thenReturn(false);

        StompHeaderAccessor acc = subscribe("/topic/team/ABC123/chat/typing", 99L);
        assertThatThrownBy(() -> interceptor.preSend(buildMessage(acc), null))
            .isInstanceOf(MessageDeliveryException.class);
    }

    @Test
    void subscribe_unknownTopic_isDenied() {
        StompHeaderAccessor acc = subscribe("/topic/admin/all", 42L);
        assertThatThrownBy(() -> interceptor.preSend(buildMessage(acc), null))
            .isInstanceOf(MessageDeliveryException.class)
            .hasMessageContaining("unknown topic");
    }

    @Test
    void subscribe_nonexistentTeamCode_isDenied() {
        when(teams.findByTeamCode("ZZZZZZ")).thenReturn(Optional.empty());
        StompHeaderAccessor acc = subscribe("/topic/team/ZZZZZZ", 42L);
        assertThatThrownBy(() -> interceptor.preSend(buildMessage(acc), null))
            .isInstanceOf(MessageDeliveryException.class);
    }
}
