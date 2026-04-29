package com.mohani.domain.chat;

import com.mohani.domain.auth.User;
import com.mohani.domain.auth.UserRepository;
import com.mohani.domain.team.Team;
import com.mohani.domain.team.TeamMemberRepository;
import com.mohani.domain.team.TeamRepository;
import com.mohani.global.auth.AuthenticatedUser;
import java.security.Principal;
import java.time.OffsetDateTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.stereotype.Controller;

// 팀 채팅: 영구저장 없이 STOMP fanout만 한다.
// 클라이언트는 SEND /app/team/{teamCode}/chat 으로 보내고, /topic/team/{teamCode}/chat 을 구독한다.
@Controller
public class ChatController {

    private static final Logger log = LoggerFactory.getLogger(ChatController.class);
    static final int MAX_TEXT_LEN = 1000;

    private final TeamRepository teams;
    private final TeamMemberRepository memberships;
    private final UserRepository users;
    private final SimpMessagingTemplate broker;

    public ChatController(TeamRepository teams,
                          TeamMemberRepository memberships,
                          UserRepository users,
                          SimpMessagingTemplate broker) {
        this.teams = teams;
        this.memberships = memberships;
        this.users = users;
        this.broker = broker;
    }

    @MessageMapping("/team/{teamCode}/chat")
    public void send(@DestinationVariable String teamCode,
                     @Payload ChatInbound msg,
                     Principal principal) {
        Long userId = extractUserId(principal);
        if (userId == null) return;
        if (msg == null || msg.text() == null) return;

        String text = msg.text().trim();
        if (text.isEmpty()) return;
        if (text.length() > MAX_TEXT_LEN) text = text.substring(0, MAX_TEXT_LEN);

        Team team = teams.findByTeamCode(teamCode).orElse(null);
        if (team == null) return;
        if (!memberships.existsByIdTeamIdAndIdUserId(team.getId(), userId)) {
            log.debug("[chat] non-member {} tried team {}", userId, teamCode);
            return;
        }

        User user = users.findById(userId).orElse(null);
        if (user == null) return;

        ChatMessage out = new ChatMessage(userId, user.getDisplayName(), text, OffsetDateTime.now());
        broker.convertAndSend("/topic/team/" + teamCode + "/chat", out);
    }

    private static Long extractUserId(Principal principal) {
        if (principal instanceof UsernamePasswordAuthenticationToken token
            && token.getPrincipal() instanceof AuthenticatedUser u) {
            return u.userId();
        }
        return null;
    }
}
