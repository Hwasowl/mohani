package com.mohani.domain.chat;

import com.mohani.domain.auth.User;
import com.mohani.domain.auth.UserRepository;
import com.mohani.domain.team.Team;
import com.mohani.domain.team.TeamMemberRepository;
import com.mohani.domain.team.TeamRepository;
import com.mohani.global.auth.AuthenticatedUser;
import java.net.URI;
import java.security.Principal;
import java.time.OffsetDateTime;
import java.util.Set;
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
// 이미지 URL은 ImgBB 호스트(https) 만 허용 — 다른 도메인은 drop (악성 링크 방어).
@Controller
public class ChatController {

    private static final Logger log = LoggerFactory.getLogger(ChatController.class);
    static final int MAX_TEXT_LEN = 1000;
    static final int MAX_URL_LEN = 512;
    // ImgBB 외 호스트는 차단. 이미지 호스트는 i.ibb.co, 뷰어는 ibb.co — 우린 이미지 URL만 받지만
    // 둘 다 화이트리스트에 두어 사용자가 viewer URL을 붙여도 통과는 시킨다(렌더 시 깨질 뿐).
    private static final Set<String> ALLOWED_IMAGE_HOSTS = Set.of(
        "i.ibb.co", "ibb.co"
    );

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
        if (msg == null) return;

        String text = normalizeText(msg.text());
        String imageUrl = normalizeImageUrl(msg.imageUrl());
        // 텍스트도 이미지도 없으면 drop
        if (text == null && imageUrl == null) return;

        Team team = teams.findByTeamCode(teamCode).orElse(null);
        if (team == null) return;
        if (!memberships.existsByIdTeamIdAndIdUserId(team.getId(), userId)) {
            log.debug("[chat] non-member {} tried team {}", userId, teamCode);
            return;
        }

        User user = users.findById(userId).orElse(null);
        if (user == null) return;

        ChatMessage out = new ChatMessage(userId, user.getDisplayName(), user.getAvatarUrl(),
            text, imageUrl, OffsetDateTime.now());
        broker.convertAndSend("/topic/team/" + teamCode + "/chat", out);
    }

    private static String normalizeText(String raw) {
        if (raw == null) return null;
        String t = raw.trim();
        if (t.isEmpty()) return null;
        return t.length() > MAX_TEXT_LEN ? t.substring(0, MAX_TEXT_LEN) : t;
    }

    private static String normalizeImageUrl(String raw) {
        if (raw == null) return null;
        String u = raw.trim();
        if (u.isEmpty()) return null;
        if (u.length() > MAX_URL_LEN) return null;
        try {
            URI uri = URI.create(u);
            if (!"https".equalsIgnoreCase(uri.getScheme())) return null;
            String host = uri.getHost();
            if (host == null) return null;
            if (!ALLOWED_IMAGE_HOSTS.contains(host.toLowerCase())) return null;
            return u;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static Long extractUserId(Principal principal) {
        if (principal instanceof UsernamePasswordAuthenticationToken token
            && token.getPrincipal() instanceof AuthenticatedUser u) {
            return u.userId();
        }
        return null;
    }
}
