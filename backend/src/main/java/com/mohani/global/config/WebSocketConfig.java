package com.mohani.global.config;

import com.mohani.domain.team.TeamMemberRepository;
import com.mohani.domain.team.TeamRepository;
import com.mohani.global.auth.JwtService;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final StompAuthInterceptor authInterceptor;

    public WebSocketConfig(JwtService jwtService, TeamRepository teams, TeamMemberRepository memberships) {
        this.authInterceptor = new StompAuthInterceptor(jwtService, teams, memberships);
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // H2 (0.1.12): Electron 전용 — REST CORS와 동일 화이트리스트 사용. 와일드카드(*) 제거.
        registry.addEndpoint("/ws")
            .setAllowedOriginPatterns(SecurityConfig.allowedOrigins().toArray(new String[0]));
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic");
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(authInterceptor);
    }
}
