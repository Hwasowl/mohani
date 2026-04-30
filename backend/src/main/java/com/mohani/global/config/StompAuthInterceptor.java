package com.mohani.global.config;

import com.mohani.domain.team.Team;
import com.mohani.domain.team.TeamMemberRepository;
import com.mohani.domain.team.TeamRepository;
import com.mohani.global.auth.AuthenticatedUser;
import com.mohani.global.auth.JwtService;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageDeliveryException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;

import java.security.Principal;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// CONNECT 시 JWT 파싱해 Principal 부여 + SUBSCRIBE 시 destination별 멤버십 검증.
// 별도 클래스로 빼서 단위 테스트 가능하게 한다.
public class StompAuthInterceptor implements ChannelInterceptor {

    // /topic/team/{code} 또는 /topic/team/{code}/<sub>
    static final Pattern TEAM_TOPIC = Pattern.compile("^/topic/team/([A-Za-z0-9]+)(?:/.*)?$");

    private final JwtService jwtService;
    private final TeamRepository teams;
    private final TeamMemberRepository memberships;

    public StompAuthInterceptor(JwtService jwtService, TeamRepository teams, TeamMemberRepository memberships) {
        this.jwtService = jwtService;
        this.teams = teams;
        this.memberships = memberships;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor acc = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (acc == null) return message;

        if (StompCommand.CONNECT.equals(acc.getCommand())) {
            String token = firstHeader(acc, "Authorization");
            if (token != null && token.startsWith("Bearer ")) {
                try {
                    long userId = jwtService.parseUserId(token.substring("Bearer ".length()).trim());
                    AuthenticatedUser principal = new AuthenticatedUser(userId);
                    acc.setUser(new UsernamePasswordAuthenticationToken(principal, token, List.of()));
                } catch (Exception ignored) {
                    // 익명 연결 진행 — SUBSCRIBE 단계에서 보호 토픽 차단.
                }
            }
            return message;
        }

        if (StompCommand.SUBSCRIBE.equals(acc.getCommand())) {
            String dest = acc.getDestination();
            if (dest == null) return message;

            Matcher m = TEAM_TOPIC.matcher(dest);
            if (!m.matches()) {
                throw new MessageDeliveryException("subscription denied: unknown topic");
            }

            Long userId = currentUserId(acc.getUser());
            if (userId == null) {
                throw new MessageDeliveryException("subscription denied: not authenticated");
            }

            String teamCode = m.group(1);
            Optional<Team> team = teams.findByTeamCode(teamCode);
            if (team.isEmpty() || !memberships.existsByIdTeamIdAndIdUserId(team.get().getId(), userId)) {
                throw new MessageDeliveryException("subscription denied: not a member");
            }
            return message;
        }

        return message;
    }

    private static Long currentUserId(Principal principal) {
        if (principal instanceof Authentication auth && auth.getPrincipal() instanceof AuthenticatedUser u) {
            return u.userId();
        }
        return null;
    }

    private static String firstHeader(StompHeaderAccessor acc, String name) {
        List<String> values = acc.getNativeHeader(name);
        return (values == null || values.isEmpty()) ? null : values.get(0);
    }
}
