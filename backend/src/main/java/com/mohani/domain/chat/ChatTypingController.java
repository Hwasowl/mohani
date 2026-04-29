package com.mohani.domain.chat;

import com.mohani.domain.auth.User;
import com.mohani.domain.auth.UserRepository;
import com.mohani.domain.team.Team;
import com.mohani.domain.team.TeamMemberRepository;
import com.mohani.domain.team.TeamRepository;
import com.mohani.global.auth.AuthenticatedUser;
import java.security.Principal;
import java.time.OffsetDateTime;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.stereotype.Controller;

// 채팅 타이핑 인디케이터 — 영구저장 없이 fanout만.
// 클라이언트가 타이핑 시작 시 SEND /app/team/{teamCode}/chat/typing.
// 받은 사람들은 일정 시간 동안 "○○님이 입력 중" 표시 (클라이언트가 timeout 관리).
@Controller
public class ChatTypingController {

    private final TeamRepository teams;
    private final TeamMemberRepository memberships;
    private final UserRepository users;
    private final SimpMessagingTemplate broker;

    public ChatTypingController(TeamRepository teams,
                                TeamMemberRepository memberships,
                                UserRepository users,
                                SimpMessagingTemplate broker) {
        this.teams = teams;
        this.memberships = memberships;
        this.users = users;
        this.broker = broker;
    }

    @MessageMapping("/team/{teamCode}/chat/typing")
    public void typing(@DestinationVariable String teamCode, Principal principal) {
        Long userId = extractUserId(principal);
        if (userId == null) return;
        Team team = teams.findByTeamCode(teamCode).orElse(null);
        if (team == null) return;
        if (!memberships.existsByIdTeamIdAndIdUserId(team.getId(), userId)) return;
        User user = users.findById(userId).orElse(null);
        if (user == null) return;
        broker.convertAndSend("/topic/team/" + teamCode + "/chat/typing",
            new TypingEvent(userId, user.getDisplayName(), OffsetDateTime.now()));
    }

    public record TypingEvent(long userId, String displayName, OffsetDateTime at) {
    }

    private static Long extractUserId(Principal principal) {
        if (principal instanceof UsernamePasswordAuthenticationToken token
            && token.getPrincipal() instanceof AuthenticatedUser u) {
            return u.userId();
        }
        return null;
    }
}
